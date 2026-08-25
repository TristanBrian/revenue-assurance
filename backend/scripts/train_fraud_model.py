"""
Fraud Scoring Layer — training pipeline.

Trains two models over the SAME feature table (services/fraud/
feature_builder.py — the one place feature logic lives, shared with
real-time scoring in services/fraud/fraud_scoring_service.py):

  1. XGBoost classifier, class-weighted via scale_pos_weight (not SMOTE
     — see the fraud-scoring spec's Section 1: our fraud types are
     qualitatively distinct — overpayment, duplicate, ghost payment,
     ring membership — and SMOTE's synthetic interpolation risks
     blending unrelated ones together).
  2. Isolation Forest, unsupervised, on the same feature set — catches
     "structurally unusual" independent of any label, for fraud
     patterns that don't match anything XGBoost was shown.

Labels: data/raw/fraud_ground_truth.csv — written by
generate_kpc_data.py, NEVER read by etl_pipeline.py or exposed through
any API/frontend. This script is the only consumer. See that file's
own header comment for the ground-truth rule (owning OMC/officer
risk_profile == "High").

Entity-aware split: the same OMC/officer never appears in both train
and test (GroupShuffleSplit grouped by actor, not a plain row-level
split) — otherwise the model could memorize a specific actor's leakage
pattern rather than learning the general shape of fraud.

Evaluated on precision/recall/average precision, not accuracy — fraud
is the rare class (~8-15% of anomalies here), so accuracy alone would
be misleading; this framing (and the class-weighting approach) mirrors
the reference lab's own guidance.

Run with (from backend/, after generate_kpc_data.py + etl_pipeline.py
have populated both the DB and data/raw/fraud_ground_truth.csv):
    python scripts/train_fraud_model.py
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import GroupShuffleSplit
from xgboost import XGBClassifier

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.fraud import feature_builder, graph_snapshot_service  # noqa: E402
from app.services.fraud.feature_builder import FEATURE_COLUMNS, actor_key  # noqa: E402
from app.services.fraud.fraud_scoring_service import (  # noqa: E402
    _patch_shap_xgboost_base_score,
)
from app.services.reconciliation.reconciliation import (  # noqa: E402
    run_outbound_reconciliation,
    run_reconciliation,
)
from app.utils.db_connection import get_engine  # noqa: E402

MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "ml_models")
GROUND_TRUTH_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw", "fraud_ground_truth.csv"
)
XGB_MODEL_PATH = os.path.join(MODEL_DIR, "fraud_xgboost.joblib")
IFOREST_MODEL_PATH = os.path.join(MODEL_DIR, "fraud_isolation_forest.joblib")
METADATA_PATH = os.path.join(MODEL_DIR, "fraud_model_metadata.json")
SHAP_SUMMARY_PATH = os.path.join(MODEL_DIR, "fraud_shap_summary.json")

RANDOM_STATE = 42

# Investigator feedback (Section 5's retraining loop) counts more than
# the synthetic ground truth once it exists — it reflects an actual
# human judgment on a real anomaly, not a generation-time proxy rule.
FEEDBACK_LABEL_TO_FRAUD = {
    "confirmed_fraud": True,
    "false_positive": False,
    "resolved_benign": False,
}
FEEDBACK_SAMPLE_WEIGHT = 5.0
SYNTHETIC_SAMPLE_WEIGHT = 1.0


def _apply_feedback_labels(features: pd.DataFrame, engine) -> tuple[pd.DataFrame, int]:
    """Overrides is_fraud for anomaly_ids that have investigator feedback
    (most recent resolution per anomaly wins if an anomaly was resolved
    more than once) and sets a higher sample_weight for those rows.
    Returns (features, count_overridden). Every row not overridden keeps
    its synthetic-ground-truth label at the default weight."""
    features = features.copy()
    features["sample_weight"] = SYNTHETIC_SAMPLE_WEIGHT

    try:
        feedback = pd.read_sql(
            "SELECT anomaly_id, resolution_label, resolved_at FROM fraud_feedback ORDER BY resolved_at ASC",
            engine,
        )
    except Exception as exc:
        print(f"⚠️  Could not load fraud_feedback for blending (non-fatal): {exc}")
        return features, 0

    if feedback.empty:
        print("ℹ️  No investigator feedback yet — training on synthetic ground truth only.")
        return features, 0

    latest_feedback = feedback.drop_duplicates(subset=["anomaly_id"], keep="last")
    label_by_id = dict(zip(latest_feedback["anomaly_id"], latest_feedback["resolution_label"]))

    overridden = 0
    for idx, row in features.iterrows():
        label = label_by_id.get(row["anomaly_id"])
        if label in FEEDBACK_LABEL_TO_FRAUD:
            features.at[idx, "is_fraud"] = FEEDBACK_LABEL_TO_FRAUD[label]
            features.at[idx, "sample_weight"] = FEEDBACK_SAMPLE_WEIGHT
            overridden += 1

    print(f"📋 Blended {overridden} investigator-feedback label(s) "
          f"(weighted {FEEDBACK_SAMPLE_WEIGHT}x vs synthetic ground truth)")
    return features, overridden


def _load_ground_truth() -> dict:
    """{record_id: bool} across all record_types (dispatch/attendance/
    disbursement) — the id namespaces don't collide (DISP-/ATT-/DISB-
    prefixes), so one flat dict is enough to join against any
    anomaly's own natural key regardless of direction/break_type."""
    if not os.path.exists(GROUND_TRUTH_PATH):
        raise FileNotFoundError(
            f"{GROUND_TRUTH_PATH} not found — run scripts/generate_kpc_data.py first "
            "(it writes this file as part of the normal generation run)."
        )
    gt = pd.read_csv(GROUND_TRUTH_PATH)
    return dict(zip(gt["record_id"], gt["is_fraud_ground_truth"]))


def _gather_anomalies_and_context(engine) -> tuple[list[dict], dict, dict]:
    """Runs both reconciliation engines at materiality=0 (the FULL
    population, including small "ordinary noise" anomalies — training
    on only large/materiality-filtered anomalies would starve the model
    of the negative examples it needs to actually discriminate).
    Returns (anomalies, inbound_context, outbound_context)."""
    print("🔄 Running inbound + outbound reconciliation at materiality=0...")
    inbound_result = run_reconciliation(materiality=0)
    outbound_result = run_outbound_reconciliation(materiality=0)
    anomalies = inbound_result.get("anomalies", []) + outbound_result.get("anomalies", [])
    print(f"   {len(inbound_result.get('anomalies', []))} inbound + {len(outbound_result.get('anomalies', []))} outbound = {len(anomalies)} total anomalies")

    dispatches_df = pd.read_sql("SELECT * FROM dispatches", engine)
    invoices_df = pd.read_sql("SELECT * FROM invoices", engine)
    inbound_context = feature_builder.gather_inbound_context(dispatches_df, invoices_df, engine)

    attendance_df = pd.read_sql("SELECT * FROM attendance", engine)
    authorizations_df = pd.read_sql("SELECT * FROM stipend_authorizations", engine)
    disbursements_df = pd.read_sql("SELECT * FROM disbursements", engine)
    outbound_context = feature_builder.gather_outbound_context(attendance_df, authorizations_df, disbursements_df)

    return anomalies, inbound_context, outbound_context


def _build_labeled_feature_table(
    anomalies: list[dict], inbound_context: dict, outbound_context: dict, ground_truth: dict
) -> pd.DataFrame:
    inbound_anomalies = [a for a in anomalies if a.get("flow_direction") != "outbound"]
    outbound_anomalies = [a for a in anomalies if a.get("flow_direction") == "outbound"]

    inbound_snapshot = graph_snapshot_service.get_snapshot("inbound")
    outbound_snapshot = graph_snapshot_service.get_snapshot("outbound")

    inbound_features = feature_builder.build_feature_table(
        inbound_anomalies,
        duplicate_ids=inbound_context["duplicate_ids"],
        graph_snapshot=inbound_snapshot,
        value_delta_zscore_by_actor=inbound_context["value_delta_zscore_by_actor"],
    )
    outbound_features = feature_builder.build_feature_table(
        outbound_anomalies,
        duplicate_ids=outbound_context["duplicate_ids"],
        graph_snapshot=outbound_snapshot,
        value_delta_zscore_by_actor=outbound_context["value_delta_zscore_by_actor"],
    )
    features = pd.concat([inbound_features, outbound_features], ignore_index=True)

    # actor_key carried alongside for the entity-aware split — dropped
    # before it ever reaches a model (it's an id, not a feature).
    all_anomalies_by_id = {a["dispatch_id"]: a for a in anomalies}
    features["actor_key"] = features["anomaly_id"].map(
        lambda aid: actor_key(all_anomalies_by_id.get(aid, {}))
    )
    features["is_fraud"] = features["anomaly_id"].map(lambda aid: bool(ground_truth.get(aid, False)))

    missing_labels = features["anomaly_id"][~features["anomaly_id"].isin(ground_truth.keys())]
    if len(missing_labels) > 0:
        print(f"⚠️  {len(missing_labels)} anomalies had no ground-truth label (defaulted to non-fraud) — "
              f"expected only if the generator/ETL data is out of sync with this run.")

    return features


def _entity_aware_split(features: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """GroupShuffleSplit grouped by actor_key — the same OMC/officer
    never appears in both train and test. Rows with no actor_key (a
    handful of edge cases, e.g. a ghost payment with no officer
    resolvable) are grouped under a synthetic per-row group so they
    don't all collapse into one giant "None" group that could otherwise
    land entirely on one side of the split."""
    groups = features["actor_key"].fillna(
        pd.Series([f"__ungrouped_{i}" for i in features.index], index=features.index)
    )
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=RANDOM_STATE)
    train_idx, test_idx = next(splitter.split(features, groups=groups))
    return features.iloc[train_idx].reset_index(drop=True), features.iloc[test_idx].reset_index(drop=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--blend-feedback", action="store_true",
        help="Blend accumulated investigator feedback (fraud_feedback table) into training "
             "labels, weighted higher than the synthetic ground truth. Used by "
             "fraud_scoring_service.maybe_retrain()'s automatic retraining trigger; omit for "
             "the initial training run (there's no feedback to blend yet).",
    )
    args = parser.parse_args()

    os.makedirs(MODEL_DIR, exist_ok=True)
    engine = get_engine()

    ground_truth = _load_ground_truth()
    print(f"📋 Loaded {len(ground_truth)} ground-truth labels "
          f"({sum(ground_truth.values())} fraud, {len(ground_truth) - sum(ground_truth.values())} non-fraud)")

    anomalies, inbound_context, outbound_context = _gather_anomalies_and_context(engine)

    print("🔄 Refreshing fraud graph snapshot for graph_community_size...")
    graph_snapshot_service.refresh_snapshot()

    features = _build_labeled_feature_table(anomalies, inbound_context, outbound_context, ground_truth)

    feedback_rows_blended = 0
    if args.blend_feedback:
        features, feedback_rows_blended = _apply_feedback_labels(features, engine)
    else:
        features["sample_weight"] = SYNTHETIC_SAMPLE_WEIGHT

    print(f"📊 Feature table: {len(features)} rows, "
          f"{features['is_fraud'].sum()} labeled fraud ({features['is_fraud'].mean():.1%})")

    train_df, test_df = _entity_aware_split(features)
    # Excludes None: a handful of anomalies (e.g. ghost payments with no
    # resolvable officer) have no real actor_key at all — _entity_aware_
    # split() already gives each of those its own synthetic one-row group
    # before splitting, so None showing up in both sides' raw actor_key
    # column is expected and NOT a real entity leak; checking it here
    # would just be reporting "both sides contain at least one row with
    # no actor," which is a different claim.
    shared_actors = (set(train_df["actor_key"]) & set(test_df["actor_key"])) - {None}
    print(f"✂️  Entity-aware split: {len(train_df)} train rows "
          f"({train_df['actor_key'].nunique()} actors), {len(test_df)} test rows "
          f"({test_df['actor_key'].nunique()} actors) — {len(shared_actors)} actor(s) shared between them "
          f"{'(should be 0 — investigate if not)' if shared_actors else '(confirmed 0)'}")

    X_train, y_train = train_df[FEATURE_COLUMNS], train_df["is_fraud"].astype(int)
    X_test, y_test = test_df[FEATURE_COLUMNS], test_df["is_fraud"].astype(int)
    train_sample_weight = train_df["sample_weight"]

    # --- XGBoost, class-weighted ---
    pos = int(y_train.sum())
    neg = int(len(y_train) - pos)
    scale_pos_weight = (neg / pos) if pos > 0 else 1.0
    print(f"⚖️  scale_pos_weight = {scale_pos_weight:.2f} ({neg} negative / {pos} positive in train)")

    # max_depth/reg_alpha/reg_lambda tuned down/up from defaults
    # deliberately: with only ~24 distinct actors in train,
    # actor_historical_anomaly_rate takes on very few distinct values, and
    # an unregularized tree can trivially carve out a split boundary that
    # exactly separates train actors by that value — a split that then
    # means nothing for a held-out actor whose own value never appeared
    # in train. Shallower trees + L1/L2 regularization is the standard
    # remedy for a model overfitting to a near-categorical feature with
    # this few distinct values, not a fix aimed at this specific dataset.
    xgb_params = dict(
        n_estimators=200,
        max_depth=3,
        learning_rate=0.1,
        reg_alpha=1.0,
        reg_lambda=2.0,
        min_child_weight=5,
        scale_pos_weight=scale_pos_weight,
        eval_metric="aucpr",
        random_state=RANDOM_STATE,
    )
    xgb_model = XGBClassifier(**xgb_params)
    t0 = time.time()
    xgb_model.fit(X_train, y_train, sample_weight=train_sample_weight)
    print(f"✅ XGBoost trained in {time.time() - t0:.1f}s"
          + (f" ({feedback_rows_blended} feedback-weighted rows included)" if feedback_rows_blended else ""))

    xgb_proba = xgb_model.predict_proba(X_test)[:, 1]

    # Classification threshold: percentile-relative to the SCORED BATCH's
    # own distribution, not a fixed absolute probability cutoff (not 0.5,
    # and — after investigating directly — not one transferred from
    # cross-validated TRAIN scores either).
    #
    # What actually happens, verified on a real run before settling on
    # this design: cross-validated TRAIN probabilities are sharply
    # bimodal (bunched near ~0 or near ~1, huge separation, CV average
    # precision 0.86+) — but TEST probabilities for genuinely unseen
    # actors top out around 0.5 (never higher), even though TEST average
    # precision was still a strong 0.818. The model is well-CALIBRATED
    # in the sense that it appropriately withholds extreme confidence
    # from actor identities it has never seen, while still RANKING them
    # correctly relative to each other. Any threshold value borrowed
    # from TRAIN's 0-or-1 scale is meaningless against TEST's compressed
    # 0-to-0.5 scale — that mismatch, not a bug in the model or an
    # unrecoverably weak model, is why a transferred CV threshold caught
    # zero test positives despite genuinely good ranking underneath.
    #
    # The fix: don't transfer an absolute cutoff across batches at all.
    # Flag the top K% most suspicious anomalies WITHIN whatever batch is
    # being scored, where K is the historical fraud rate observed in
    # TRAIN (not derived from test labels — only from train's rate, a
    # legitimate prior, applied to test's own score distribution). This
    # is also the correct design for fraud_scoring_service.py's
    # fraud_tier assignment in production: rank within the current
    # scoring batch, not against a fixed global number — the same
    # reasoning applies identically at serving time.
    expected_fraud_rate = float(y_train.mean())
    best_threshold = float(np.percentile(xgb_proba, 100 * (1 - expected_fraud_rate)))
    print(f"🎯 Percentile-relative threshold (top {expected_fraud_rate:.1%} of this batch's scores, "
          f"rate from train): {best_threshold:.4f}")

    xgb_pred = (xgb_proba >= best_threshold).astype(int)
    xgb_pred_fixed = (xgb_proba >= 0.5).astype(int)  # reported alongside for transparency

    # --- Isolation Forest, unsupervised ---
    contamination = min(max(float(y_train.mean()), 0.01), 0.5)
    iforest = IsolationForest(n_estimators=200, contamination=contamination, random_state=RANDOM_STATE)
    iforest.fit(X_train)
    print(f"✅ Isolation Forest trained (contamination={contamination:.3f})")

    # decision_function: higher = more normal. Flip and min-max scale to
    # [0, 1] so novelty_score reads "higher = more anomalous", matching
    # xgb_proba's own "higher = more fraud-like" direction.
    raw_novelty = -iforest.decision_function(X_test)
    novelty_score = (raw_novelty - raw_novelty.min()) / (raw_novelty.max() - raw_novelty.min() + 1e-9)
    novelty_pred = (iforest.predict(X_test) == -1).astype(int)  # -1 = outlier

    # --- Evaluation: precision/recall/average precision, not accuracy ---
    metrics = {
        "xgboost": {
            "threshold_used": best_threshold,
            "precision": float(precision_score(y_test, xgb_pred, zero_division=0)),
            "recall": float(recall_score(y_test, xgb_pred, zero_division=0)),
            "f1": float(f1_score(y_test, xgb_pred, zero_division=0)),
            "average_precision": float(average_precision_score(y_test, xgb_proba)),
            "confusion_matrix": confusion_matrix(y_test, xgb_pred).tolist(),  # [[TN, FP], [FN, TP]]
            # Reported alongside for transparency, not as the headline
            # numbers — see the threshold-selection comment above for why
            # a fixed 0.5 cutoff is the wrong number to lead with for a
            # scale_pos_weight-trained model.
            "at_fixed_0.5_threshold": {
                "precision": float(precision_score(y_test, xgb_pred_fixed, zero_division=0)),
                "recall": float(recall_score(y_test, xgb_pred_fixed, zero_division=0)),
                "f1": float(f1_score(y_test, xgb_pred_fixed, zero_division=0)),
            },
        },
        "isolation_forest": {
            # Reported for completeness — Isolation Forest is unsupervised
            # by design (it never sees y_train), so these numbers describe
            # how well its independent "structurally unusual" signal
            # happens to line up with the known labels, not a claim it
            # was trained to optimize this.
            "precision": float(precision_score(y_test, novelty_pred, zero_division=0)),
            "recall": float(recall_score(y_test, novelty_pred, zero_division=0)),
            "f1": float(f1_score(y_test, novelty_pred, zero_division=0)),
            "average_precision": float(average_precision_score(y_test, novelty_score)),
        },
    }
    print(f"📈 XGBoost — precision: {metrics['xgboost']['precision']:.3f}, "
          f"recall: {metrics['xgboost']['recall']:.3f}, "
          f"F1: {metrics['xgboost']['f1']:.3f}, "
          f"average precision: {metrics['xgboost']['average_precision']:.3f}")
    print(f"📈 Isolation Forest — precision: {metrics['isolation_forest']['precision']:.3f}, "
          f"recall: {metrics['isolation_forest']['recall']:.3f}, "
          f"average precision: {metrics['isolation_forest']['average_precision']:.3f}")

    # --- SHAP global summary (for the Impact Memo/pitch) ---
    print("🔍 Computing SHAP values...")
    import shap

    # xgboost>=2 serializes base_score as a bracketed-array string that
    # shap==0.49.1 can't parse on its own — same fix the serving path
    # applies in _get_shap_explainer(); without it this crashes right
    # after training with "could not convert string to float: '[...]'".
    _patch_shap_xgboost_base_score()
    explainer = shap.TreeExplainer(xgb_model)
    shap_values = explainer.shap_values(X_test)
    mean_abs_shap = np.abs(shap_values).mean(axis=0)
    global_importance = sorted(
        [{"feature": col, "mean_abs_shap": float(val)} for col, val in zip(FEATURE_COLUMNS, mean_abs_shap)],
        key=lambda x: x["mean_abs_shap"],
        reverse=True,
    )
    print("   Top features by mean |SHAP value|:")
    for entry in global_importance[:5]:
        print(f"     {entry['feature']}: {entry['mean_abs_shap']:.4f}")

    # Local force-plot capability — sanity-checked here (not saved as a
    # plot; the live per-anomaly explanation is served by
    # fraud_scoring_service.explain_anomaly(), which recomputes this on
    # demand for whichever anomaly an investigator is looking at), just
    # confirming a single-row explanation actually works end to end
    # before anything downstream depends on it.
    if len(X_test) > 0:
        _ = explainer.shap_values(X_test.iloc[[0]])
        print("   ✅ Local (single-row) SHAP explanation confirmed working.")

    # --- Serialize ---
    joblib.dump(xgb_model, XGB_MODEL_PATH)
    joblib.dump(iforest, IFOREST_MODEL_PATH)
    with open(SHAP_SUMMARY_PATH, "w") as f:
        json.dump({"global_importance": global_importance}, f, indent=2)

    metadata = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "feature_columns": FEATURE_COLUMNS,
        "train_size": len(train_df),
        "test_size": len(test_df),
        "train_fraud_rate": float(y_train.mean()),
        "test_fraud_rate": float(y_test.mean()),
        "scale_pos_weight": scale_pos_weight,
        "expected_fraud_rate": expected_fraud_rate,  # what fraud_scoring_service.py uses at serving
        # time — via np.percentile(this_batch_scores, 100 * (1 - expected_fraud_rate)),
        # recomputed fresh per scoring batch, NOT this absolute value. This field is
        # this training run's OWN test-set threshold, kept for debugging/reference
        # only — an absolute probability cutoff does not transfer across batches (see
        # the long comment above best_threshold's computation for why), so nothing
        # should ever load this number and reuse it directly as a fixed cutoff.
        "last_run_reference_threshold_do_not_reuse_directly": best_threshold,
        "isolation_forest_contamination": contamination,
        "metrics": metrics,
        "feedback_blended": args.blend_feedback,
        "feedback_rows_blended": feedback_rows_blended,
    }
    with open(METADATA_PATH, "w") as f:
        json.dump(metadata, f, indent=2)

    # Append-only log — METADATA_PATH always reflects only the LATEST
    # run (fraud_scoring_service.py reads it that way), but the pitch
    # wants to show improvement over successive retrains, which an
    # overwritten file can't do. One JSON line per run, oldest first.
    retrain_log_path = os.path.join(MODEL_DIR, "fraud_model_retrain_log.jsonl")
    with open(retrain_log_path, "a") as f:
        f.write(json.dumps({
            "trained_at": metadata["trained_at"],
            "feedback_blended": metadata["feedback_blended"],
            "feedback_rows_blended": metadata["feedback_rows_blended"],
            "train_size": metadata["train_size"],
            "test_size": metadata["test_size"],
            "metrics": metadata["metrics"],
        }) + "\n")

    print(f"\n✅ Model artifacts written to {MODEL_DIR}/")
    print(f"   {XGB_MODEL_PATH}")
    print(f"   {IFOREST_MODEL_PATH}")
    print(f"   {METADATA_PATH}")
    print(f"   {SHAP_SUMMARY_PATH}")


if __name__ == "__main__":
    main()
