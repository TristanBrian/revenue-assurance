"""
Real-time fraud scoring, explainability, and the investigator-feedback
retraining loop — the serving half of the fraud scoring layer (see
scripts/train_fraud_model.py for the offline training half; both use
services/fraud/feature_builder.py as the one shared source of feature
logic).

Loads model artifacts lazily from app/ml_models/ (written by
train_fraud_model.py) and gates every public function on is_configured()
— same "not configured, not an error" posture as alert_service.py's SMTP
gate and anchor_service.py's CDP/contract gate: a fresh checkout with no
trained model yet just runs reconciliation without fraud_score/fraud_tier
populated, not a crash.

fraud_score/fraud_tier are NOT persisted anywhere — anomalies themselves
aren't persisted rows (see reconciliation.py's module-level notes: they're
computed dicts, rebuilt fresh on every reconciliation run), so scoring is
an enrichment step applied to that same freshly-computed list, exactly
like the resolution_status overlay already is. Nothing here needs a
"score storage" table.
"""
import ast
import asyncio
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.models.fraud.fraud_feedback import FraudFeedback
from app.services.fraud import feature_builder, graph_snapshot_service

logger = logging.getLogger("kpc.fraud.scoring")

_APP_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_BACKEND_DIR = os.path.dirname(_APP_DIR)
MODEL_DIR = os.path.join(_APP_DIR, "ml_models")
XGB_MODEL_PATH = os.path.join(MODEL_DIR, "fraud_xgboost.joblib")
IFOREST_MODEL_PATH = os.path.join(MODEL_DIR, "fraud_isolation_forest.joblib")
METADATA_PATH = os.path.join(MODEL_DIR, "fraud_model_metadata.json")
SHAP_SUMMARY_PATH = os.path.join(MODEL_DIR, "fraud_shap_summary.json")
TRAIN_SCRIPT_PATH = os.path.join(_BACKEND_DIR, "scripts", "train_fraud_model.py")

FRAUD_TIER_LIKELY = "Likely Fraud"
FRAUD_TIER_SUSPICIOUS = "Suspicious"
FRAUD_TIER_BENIGN = "Likely Benign"

# fraud_score = this blend, scaled to 0-100. XGBoost is the primary,
# labeled signal (0.7) — it knows what confirmed fraud patterns actually
# look like. Isolation Forest is a secondary, label-blind signal (0.3) —
# it exists specifically to catch structurally-unusual anomalies XGBoost
# has never been shown a labeled example of, per the fraud-scoring spec's
# Section 1; weighting it below XGBoost reflects that it's a
# corroborating signal, not the primary one, for anomalies that DO
# resemble known patterns.
XGB_WEIGHT = 0.7
NOVELTY_WEIGHT = 0.3

# Batch/timer retrain trigger (Section 5) — daily is "reasonable for a
# hackathon demo" per the spec; N new feedback rows is the other half of
# the "whichever comes first" rule.
RETRAIN_MIN_NEW_FEEDBACK = 20
RETRAIN_MIN_INTERVAL_SECONDS = 24 * 60 * 60

_xgb_model = None
_iforest_model = None
_metadata = None
_shap_explainer = None
_last_retrain_check_at: Optional[datetime] = None


def is_configured() -> bool:
    """False means: no trained model yet (fresh checkout, or
    train_fraud_model.py hasn't been run). Every public scoring/
    explanation function checks this first and degrades gracefully
    rather than raising."""
    return all(os.path.exists(p) for p in (XGB_MODEL_PATH, IFOREST_MODEL_PATH, METADATA_PATH))


def _load_models():
    """Loads once, cached at module scope — a joblib.load() of a small
    tree ensemble is cheap, but there's no reason to repeat it on every
    single reconciliation request. reload_models() below invalidates the
    cache after a retrain."""
    global _xgb_model, _iforest_model, _metadata
    if _xgb_model is None and is_configured():
        _xgb_model = joblib.load(XGB_MODEL_PATH)
        _iforest_model = joblib.load(IFOREST_MODEL_PATH)
        with open(METADATA_PATH) as f:
            _metadata = json.load(f)
        logger.info(f"✅ Fraud models loaded (trained_at={_metadata.get('trained_at')})")
    return _xgb_model, _iforest_model, _metadata


def reload_models() -> None:
    """Forces the next call to re-read model files from disk — called
    after a successful retrain so serving picks up the new artifacts
    without needing an app restart."""
    global _xgb_model, _iforest_model, _metadata, _shap_explainer
    _xgb_model = None
    _iforest_model = None
    _metadata = None
    _shap_explainer = None


def _patch_shap_xgboost_base_score() -> None:
    """One-time monkeypatch of shap's XGBoost model loader, applied lazily
    on first use (see _get_shap_explainer() below) rather than at module
    import time — shap is itself only imported lazily, to keep it an
    optional dependency of a module fraud/reconciliation code can import
    without it installed (is_configured() gates every caller anyway).

    xgboost>=2 always represents learner_model_param.base_score as a
    bracketed-array string (e.g. "[5E-1]", not "0.5") in EVERY
    serialization it produces — verified directly: writing a plain
    unwrapped value back into a booster and re-serializing it still comes
    back bracketed, so this isn't something fixable by rewriting the
    model file, only by fixing how it's read. shap==0.49.1's
    XGBTreeModelLoader parses that field with a bare
    float(learner_model_param["base_score"]), which raises "could not
    convert string to float: '[5E-1]'" for every trained model here —
    every call to explain_anomaly()/GET /api/fraud/explain/{id} 500s.

    Later shap releases fix this themselves (ast.literal_eval + list/
    array unwrapping), but every one of them requires numpy>=2, which
    conflicts with this project's langchain/langchain-community pins
    (numpy<2 on Python<3.12 — see requirements.txt) used by
    app/services/rag/, so upgrading shap isn't safely available here.

    Instead: wrap shap.explainers._tree.decode_ubjson_buffer — the exact
    function XGBTreeModelLoader calls to turn a booster's raw serialized
    bytes into the dict it then reads base_score from — so the unwrapped
    value is already in place by the time shap's own code looks at it.
    Idempotent: marks the wrapper so a second call (e.g. after
    reload_models() following a retrain) doesn't stack wrappers."""
    import shap.explainers._tree as shap_tree

    if getattr(shap_tree.decode_ubjson_buffer, "_kpc_base_score_patched", False):
        return

    original_decode = shap_tree.decode_ubjson_buffer

    def _decode_with_fixed_base_score(fd):
        doc = original_decode(fd)
        try:
            param = doc["learner"]["learner_model_param"]
            base_score = param.get("base_score")
            if isinstance(base_score, str) and base_score.strip().startswith("["):
                value = ast.literal_eval(base_score)
                if isinstance(value, (list, tuple)):
                    value = value[0]
                param["base_score"] = repr(float(value))
        except (KeyError, TypeError, ValueError, SyntaxError) as exc:
            # Unexpected shape (a shap/xgboost version bump changed the
            # format again) — leave doc untouched and let shap raise its
            # own error rather than fail silently on a wrong value.
            logger.warning(f"Could not patch xgboost base_score for shap (non-fatal, leaving as-is): {exc}")
        return doc

    _decode_with_fixed_base_score._kpc_base_score_patched = True
    shap_tree.decode_ubjson_buffer = _decode_with_fixed_base_score


def _get_shap_explainer():
    global _shap_explainer
    if _shap_explainer is None:
        import shap

        _patch_shap_xgboost_base_score()
        xgb_model, _, _ = _load_models()
        _shap_explainer = shap.TreeExplainer(xgb_model)
    return _shap_explainer


def score_anomalies(
    anomalies: list[dict],
    *,
    direction: str,
    duplicate_ids: Optional[set] = None,
    value_delta_zscore_by_actor: Optional[dict] = None,
) -> list[dict]:
    """
    Adds `fraud_score` (0-100, float) and `fraud_tier` (Likely Fraud /
    Suspicious / Likely Benign) to every dict in `anomalies`, in place,
    and returns the same list. If not configured, sets both to None
    rather than omitting the keys — callers (and the Anomaly schema) can
    rely on the keys always being present.

    Tiers are assigned by PERCENTILE WITHIN THIS BATCH, not a fixed
    global score cutoff — see train_fraud_model.py's threshold-selection
    comment for the full reasoning (a fixed absolute probability cutoff
    doesn't transfer across scoring batches; a model appropriately gives
    more compressed/conservative scores to actors it has less history
    on). expected_fraud_rate (from training metadata) sets how large the
    "Likely Fraud" band is; the next 2x that rate is "Suspicious"; the
    rest is "Likely Benign".
    """
    if not anomalies:
        return anomalies
    if not is_configured():
        for a in anomalies:
            a["fraud_score"] = None
            a["fraud_tier"] = None
        return anomalies

    xgb_model, iforest_model, metadata = _load_models()
    graph_snapshot = graph_snapshot_service.get_snapshot(direction)

    features = feature_builder.build_feature_table(
        anomalies,
        duplicate_ids=duplicate_ids,
        graph_snapshot=graph_snapshot,
        value_delta_zscore_by_actor=value_delta_zscore_by_actor,
    )
    X = features[feature_builder.FEATURE_COLUMNS]

    xgb_proba = xgb_model.predict_proba(X)[:, 1]
    raw_novelty = -iforest_model.decision_function(X)
    span = float(raw_novelty.max() - raw_novelty.min())
    novelty_score = (raw_novelty - raw_novelty.min()) / (span + 1e-9) if span > 0 else np.zeros_like(raw_novelty)

    combined = XGB_WEIGHT * xgb_proba + NOVELTY_WEIGHT * novelty_score
    fraud_score = np.round(combined * 100, 1)

    expected_fraud_rate = float(metadata.get("expected_fraud_rate", 0.15))
    likely_cutoff = np.percentile(combined, 100 * (1 - expected_fraud_rate))
    suspicious_cutoff = np.percentile(combined, 100 * (1 - min(2 * expected_fraud_rate, 0.9)))

    # build_feature_table() preserves row order 1:1 with the input
    # `anomalies` list (see its own docstring) — safe to zip positionally
    # rather than re-joining on anomaly_id.
    for anomaly, score, blended in zip(anomalies, fraud_score, combined):
        anomaly["fraud_score"] = float(score)
        if blended >= likely_cutoff:
            anomaly["fraud_tier"] = FRAUD_TIER_LIKELY
        elif blended >= suspicious_cutoff:
            anomaly["fraud_tier"] = FRAUD_TIER_SUSPICIOUS
        else:
            anomaly["fraud_tier"] = FRAUD_TIER_BENIGN

    return anomalies


def explain_anomaly(
    anomaly: dict,
    *,
    direction: str,
    duplicate_ids: Optional[set] = None,
    value_delta_zscore_by_actor: Optional[dict] = None,
) -> Optional[dict]:
    """
    Local SHAP explanation for ONE anomaly — backs GET /fraud/explain/
    {anomaly_id}. Returns None if not configured. Each contributor is
    {feature, value, contribution, direction} where direction is
    "toward_fraud" (positive SHAP value) or "toward_benign" (negative),
    sorted by |contribution| descending — the plain-language framing
    (feature name, value, direction) is built here so the API/chat-explain
    endpoint don't have to know anything about SHAP's own value semantics.
    """
    if not is_configured():
        return None

    xgb_model, _, _ = _load_models()
    graph_snapshot = graph_snapshot_service.get_snapshot(direction)
    features = feature_builder.build_feature_table(
        [anomaly],
        duplicate_ids=duplicate_ids,
        graph_snapshot=graph_snapshot,
        value_delta_zscore_by_actor=value_delta_zscore_by_actor,
    )
    X = features[feature_builder.FEATURE_COLUMNS]

    explainer = _get_shap_explainer()
    shap_values = explainer.shap_values(X)[0]
    base_value = float(explainer.expected_value if np.isscalar(explainer.expected_value) else explainer.expected_value[0])

    contributors = sorted(
        [
            {
                "feature": col,
                "value": float(X.iloc[0][col]),
                "contribution": float(val),
                "direction": "toward_fraud" if val > 0 else "toward_benign",
            }
            for col, val in zip(feature_builder.FEATURE_COLUMNS, shap_values)
        ],
        key=lambda c: abs(c["contribution"]),
        reverse=True,
    )

    return {
        "anomaly_id": anomaly.get("dispatch_id"),
        "fraud_score": anomaly.get("fraud_score"),
        "fraud_tier": anomaly.get("fraud_tier"),
        "base_value": base_value,
        "contributors": contributors,
    }


# =============================================================================
# Feedback loop
# =============================================================================

def record_feedback(
    db: Session,
    *,
    anomaly_id: str,
    resolution_label: str,
    resolved_by=None,
) -> FraudFeedback:
    """
    Writes one FraudFeedback row. Called from update_anomaly_status()
    (services/ebilling/e_billing.py) whenever a resolution carries a
    fraud judgment — appended, never upserted (see FraudFeedback's
    docstring for why: this is a full history, not current-state).
    Flushes but does not commit — same commit-boundary convention as
    audit_service.log_action(): the caller's own transaction covers this
    atomically alongside the resolution write it accompanies.
    """
    entry = FraudFeedback(
        anomaly_id=anomaly_id,
        resolution_label=resolution_label,
        resolved_by=resolved_by,
        resolved_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.flush()
    return entry


def maybe_retrain(db: Session) -> bool:
    """
    Batch/timer retraining trigger — retrains when RETRAIN_MIN_NEW_
    FEEDBACK new feedback rows have accumulated since the last retrain,
    or RETRAIN_MIN_INTERVAL_SECONDS has passed, whichever comes first
    (mirrors anchor_service.maybe_anchor_chain_tip()'s exact threshold
    shape). Runs the training script as a subprocess — deliberately not
    imported and called in-process: training briefly holds a large
    working set (the full anomaly feature table) and runs CPU-bound
    XGBoost/SHAP work that would otherwise share the API server's own
    process/event loop; a subprocess isolates that and lets the OS clean
    up all of it on exit regardless of how the training run goes.

    Returns True if a retrain was actually run (regardless of whether it
    succeeded — check logs for the outcome), False if the threshold
    wasn't met or retraining isn't configured yet (no baseline model to
    blend feedback into — the very first training run always happens via
    running scripts/train_fraud_model.py directly, not through this
    trigger).
    """
    if not is_configured():
        return False

    _, _, metadata = _load_models()
    last_trained_at_str = metadata.get("trained_at") if metadata else None
    if last_trained_at_str:
        last_trained_at = datetime.fromisoformat(last_trained_at_str)
        seconds_since_last = (datetime.now(timezone.utc) - last_trained_at).total_seconds()
    else:
        seconds_since_last = float("inf")

    new_feedback_count = (
        db.query(FraudFeedback)
        .filter(FraudFeedback.resolved_at >= datetime.fromisoformat(last_trained_at_str) if last_trained_at_str else True)
        .count()
    )

    if new_feedback_count < RETRAIN_MIN_NEW_FEEDBACK and seconds_since_last < RETRAIN_MIN_INTERVAL_SECONDS:
        return False

    logger.info(
        f"🔄 Retrain threshold met ({new_feedback_count} new feedback rows, "
        f"{seconds_since_last:.0f}s since last train) — running scripts/train_fraud_model.py..."
    )
    try:
        result = subprocess.run(
            [sys.executable, TRAIN_SCRIPT_PATH, "--blend-feedback"],
            cwd=_BACKEND_DIR,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            logger.error(f"Retrain failed (non-fatal — serving keeps using the previous model): {result.stderr[-2000:]}")
            return True
        reload_models()
        logger.info("✅ Retrain complete, models reloaded.")
    except Exception as exc:
        logger.error(f"Retrain subprocess failed to run (non-fatal): {exc}")
    return True


async def run_periodic_retrain_check(interval_seconds: int = 60 * 60) -> None:
    """Background loop — started from app/main.py's lifespan alongside
    the audit-anchor and graph-snapshot checks, cancelled on shutdown.
    Polls hourly (retraining itself only actually runs once the
    RETRAIN_MIN_NEW_FEEDBACK/RETRAIN_MIN_INTERVAL_SECONDS threshold is
    met — this loop is just the timer, maybe_retrain() is the decision).
    Always started regardless of is_configured() — maybe_retrain() itself
    no-ops immediately when there's no baseline model yet.

    maybe_retrain() is sync and blocks on subprocess.run(..., timeout=600)
    — run it in a worker thread via asyncio.to_thread so a slow/hung
    training run stalls only that thread, not the event loop the API
    server itself is running on."""
    from app.utils.db_connection import SessionLocal

    while True:
        try:
            db = SessionLocal()
            try:
                await asyncio.to_thread(maybe_retrain, db)
            finally:
                db.close()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"Periodic retrain check failed (non-fatal, retried next tick): {exc}")
        await asyncio.sleep(interval_seconds)


# =============================================================================
# Chat-style explain (Section 6) — a lightweight canned-response function
# keyed on message content, grounded in real stored SHAP/metrics data.
# NOT an LLM call — modeled directly on the reference app.py's /api/chat
# pattern per the fraud-scoring spec, cheap to build and grounded entirely
# in data this module already has on hand, never fabricated text.
# =============================================================================

def chat_explain(
    message: str,
    *,
    anomaly: Optional[dict] = None,
    direction: Optional[str] = None,
    duplicate_ids: Optional[set] = None,
    value_delta_zscore_by_actor: Optional[dict] = None,
) -> str:
    """
    Backs POST /fraud/chat. Recognizes two question shapes:
    - "why is this flagged" / "why fraud" / "why this score" — requires
      `anomaly` (the route resolves anomaly_id -> the anomaly dict before
      calling this); explains via explain_anomaly()'s top SHAP
      contributors.
    - "how good is the model" / "precision" / "recall" / "accuracy" —
      pulls the stored evaluation metrics from training and explains the
      precision-recall framing (why accuracy alone would be misleading
      for a rare-class problem like fraud).
    Anything else gets a short menu of what it can answer, not a guess.
    """
    text = message.lower()

    if "why" in text and any(k in text for k in ("flag", "fraud", "score", "suspicious")):
        if anomaly is None:
            return "I can explain why a specific anomaly was flagged — please select one first, then ask again."
        if not is_configured():
            return "The fraud scoring model hasn't been trained yet, so there's no score to explain for this anomaly."
        explanation = explain_anomaly(
            anomaly, direction=direction or anomaly.get("flow_direction", "inbound"),
            duplicate_ids=duplicate_ids, value_delta_zscore_by_actor=value_delta_zscore_by_actor,
        )
        if not explanation:
            return "I couldn't compute an explanation for this anomaly right now."
        lines = [
            f"Anomaly {explanation['anomaly_id']} scored {explanation['fraud_score']}/100 "
            f"({explanation['fraud_tier']})."
        ]
        for c in explanation["contributors"][:3]:
            verb = "pushed the score UP toward fraud" if c["direction"] == "toward_fraud" else "pushed the score DOWN toward benign"
            lines.append(f"- {c['feature']} = {c['value']:.2f} {verb} (contribution {c['contribution']:+.3f})")
        return "\n".join(lines)

    if "how good" in text or "accura" in text or ("precision" in text and "recall" in text) or "how well" in text:
        if not is_configured():
            return "The fraud scoring model hasn't been trained yet — run scripts/train_fraud_model.py to get real numbers here."
        _, _, metadata = _load_models()
        m = metadata["metrics"]["xgboost"]
        return (
            f"The model is evaluated on precision/recall/average precision, not accuracy — fraud is a rare "
            f"class ({metadata['train_fraud_rate']:.1%} of anomalies here), so a model that always guessed "
            f"\"not fraud\" would still score high accuracy while catching nothing. "
            f"Current numbers: precision {m['precision']:.1%} (of what it flags, this share really is fraud), "
            f"recall {m['recall']:.1%} (of all real fraud, this share gets caught), "
            f"average precision {m['average_precision']:.3f} (ranking quality independent of any threshold). "
            f"Trained on {metadata['train_size']} anomalies, evaluated on {metadata['test_size']} held out from "
            f"OMCs/officers the model never saw during training — not just held-out rows."
        )

    return (
        "I can answer:\n"
        "- \"why is this flagged\" — explains a specific anomaly's fraud score\n"
        "- \"how good is the model\" — reports precision/recall/average precision\n"
        "Try one of those."
    )
