"""
feature_builder.py — the ONE place fraud-scoring feature logic lives.

Called identically by:
  - scripts/train_fraud_model.py (offline, over historical/synthetic
    anomalies + is_fraud_ground_truth labels)
  - services/fraud/fraud_scoring_service.py (real-time, inline during
    run_reconciliation()/run_outbound_reconciliation())

so the two can never drift apart from each other — the fraud-scoring
spec's explicit requirement. Neither caller builds a feature row any
other way.

Feature table shape (one row per anomaly dict — see
services/reconciliation/reconciliation.py's anomaly dict for the exact
fields these are read from):

    flow_direction_outbound   1.0 if flow_direction == "outbound" else 0.0
    anomaly_type_code         break_type, integer-encoded (see ANOMALY_TYPE_CODES)
    materiality_ratio         leakage_kes / max(dispatched_kes, 1) — how much
                               of the expected value leaked, not just the raw
                               leakage amount (a 1M leak on a 100M chain reads
                               very differently from a 1M leak on a 1.2M one)
    value_delta_zscore        per-actor statistical outlier score — from
                               detective_service.compute_omc_risk_features()
                               for inbound; no outbound equivalent exists yet
                               (see module docstring's "Known gap" below), 0.0
                               there
    duplicate_flag            1.0 if this anomaly's own key is part of a
                               detect_duplicates()-style duplicate group
    graph_community_size      size of the Louvain community this anomaly's
                               actor belongs to, from the periodic graph
                               snapshot (services/fraud/graph_snapshot_service.py)
                               — 0.0 if the actor isn't in the current snapshot
                               (e.g. graph hasn't refreshed since this actor's
                               first anomaly)
    actor_historical_anomaly_rate  this actor's anomaly count / this actor's
                               total anomaly-batch appearances, computed
                               within the SAME batch of anomalies being
                               scored — see actor_key()'s docstring for why
                               this doesn't need a separate history table
    aging_days                age_days, as-is
    severity_tier_code        status, integer-encoded (see SEVERITY_TIER_CODES)

Known gap, stated plainly rather than papered over: there is no
outbound equivalent of detective_service.py's per-OMC statistical
features (ghost_load_rate, value_delta_zscore, ...) yet — building one
is a real follow-up (mirroring detective_service.py for officers), not
done here. value_delta_zscore defaults to 0.0 for every outbound
anomaly, which XGBoost/Isolation Forest read as "unremarkable on this
axis," not as a false negative signal — it simply isn't informative for
outbound rows yet. Documented here so nobody mistakes the 0.0 for a
real "no statistical anomaly" finding.
"""
from typing import Optional

import numpy as np
import pandas as pd

FEATURE_COLUMNS = [
    "flow_direction_outbound",
    "anomaly_type_code",
    "materiality_ratio",
    "value_delta_zscore",
    "duplicate_flag",
    "graph_community_size",
    "actor_historical_anomaly_rate",
    "aging_days",
    "severity_tier_code",
]

# Fixed, explicit encodings (not pd.factorize()'s data-dependent integer
# assignment) so a category always maps to the same integer across
# training and every later scoring run, regardless of which categories
# happen to appear in a given batch.
ANOMALY_TYPE_CODES = {
    "Missing Invoice": 0,
    "Missing Payment": 1,
    "Underpayment": 2,
    "Overpayment": 3,
    "Reconciled": 4,
    "Missing Authorization": 5,
    "Missing Disbursement": 6,
    "Ghost Payment": 7,
    "Duplicate Disbursement": 8,
}
SEVERITY_TIER_CODES = {
    "Critical": 0,
    "Pending": 1,
    "Review Required": 2,
    "Reconciled": 3,
}
_UNKNOWN_CODE = -1


def actor_key(anomaly: dict) -> Optional[str]:
    """
    Which identity "the responsible actor" resolves to, for both
    actor_historical_anomaly_rate and the graph-snapshot lookup:
    - inbound: `customer` (the OMC's name) — the same grouping key
      calculate_omc_risk() and graph_engine's OMC nodes already use, so
      no extra omc_id lookup/join is needed to line features up with
      those existing signals.
    - outbound: `officer_id` — the staff actor with direct
      responsibility for a beneficiary's stipend chain. beneficiary_id
      isn't used here: a beneficiary having several of their own
      payments flagged mostly reflects individual bad luck or targeted
      fraud against THEM, not a pattern to investigate an actor for,
      whereas an officer with a disproportionate anomaly rate across
      many different beneficiaries is exactly the "who to investigate"
      signal this feature exists to capture.
    """
    if anomaly.get("flow_direction") == "outbound":
        return anomaly.get("officer_id")
    return anomaly.get("customer")


def _duplicate_flag(anomaly: dict, duplicate_ids: Optional[set]) -> float:
    if anomaly.get("break_type") == "Duplicate Disbursement":
        return 1.0
    if duplicate_ids and anomaly.get("dispatch_id") in duplicate_ids:
        return 1.0
    return 0.0


def _graph_community_size(anomaly: dict, graph_snapshot: Optional[dict]) -> float:
    """graph_snapshot: {actor_key: community_size} — see
    graph_snapshot_service.py for how this is built and refreshed. Keyed
    by the same actor_key() value (OMC name for inbound, officer_id for
    outbound), matching graph_engine.py's node `label` field directly —
    an OMC node's label IS the OMC's customer_name; an officer node's
    label IS the raw officer_id — so no extra id-mapping join is needed
    here either."""
    if not graph_snapshot:
        return 0.0
    key = actor_key(anomaly)
    return float(graph_snapshot.get(key, {}).get("community_size", 0)) if key else 0.0


def _actor_historical_anomaly_rate(actor_keys: pd.Series) -> pd.Series:
    """
    Rate of past anomalies tied to this actor, computed WITHIN the
    current batch of anomalies being scored/trained on rather than from
    a separate stored history table — deliberately, not as a shortcut:
    every reconciliation run already recomputes anomalies over the
    ENTIRE dispatches/invoices/payments (or attendance/authorization/
    disbursement) history each time (see reconciliation.py — nothing is
    windowed to "recent" data), so the current batch already IS this
    actor's full anomaly history as of this run. A separate persisted
    history table would just be re-deriving the same number from a
    stored copy of data this function already has in hand.

    Rate = (this actor's anomaly count in this batch) / (this actor's
    anomaly count in this batch) is trivially 1.0 per-row if computed
    naively — the actual signal is each actor's SHARE of the total
    anomaly count relative to every other actor, i.e. a normalized
    frequency, not a literal "rate against total transactions" (this
    function has no visibility into an actor's non-anomalous
    transactions, only the anomalies themselves).

    Returns each row's actor's PERCENTILE RANK among all actors' anomaly
    counts in this batch (0 to 1) — not count / max(count). Max-
    normalizing was tried first and rejected after a live entity-aware
    training run: with ~35 actors total, that scheme makes the feature's
    numeric value highly specific to which exact actor happens to hold
    the batch's single highest count, so a model trained on one set of
    actors sees values that don't recur for a held-out set of DIFFERENT
    actors — XGBoost ended up splitting on train-specific values that
    never matched at test time (precision/recall both landed at exactly
    0 on a real run, despite a meaningfully-above-baseline average
    precision, showing the model had *some* signal it just couldn't
    threshold on). Percentile rank instead encodes "high relative to
    everyone else in this batch" the same way regardless of which actors
    happen to be present, which is the property this feature actually
    needs to generalize to unseen actors.
    """
    counts = actor_keys.value_counts()
    if counts.empty:
        return actor_keys.map(lambda k: 0.0)
    percentile_by_count = counts.rank(pct=True)
    return actor_keys.map(lambda k: float(percentile_by_count.get(k, 0.0)) if k is not None else 0.0)


def build_feature_table(
    anomalies: list[dict],
    *,
    duplicate_ids: Optional[set] = None,
    graph_snapshot: Optional[dict] = None,
    value_delta_zscore_by_actor: Optional[dict] = None,
) -> pd.DataFrame:
    """
    One row per anomaly dict, in the same order as `anomalies`. Returns
    a DataFrame with FEATURE_COLUMNS plus `anomaly_id` (the anomaly's
    own dispatch_id-shaped natural key, for joining scores back onto the
    original anomalies afterward) — anomaly_id is not itself a feature
    and must be dropped before feeding a model.

    duplicate_ids: set of dispatch_id-shaped keys already known to be
        duplicated (computed by the caller via the raw table's own
        `.duplicated(subset=[...], keep=False)` — the same full-fidelity
        technique run_outbound_reconciliation_on_dataframes() already
        uses for Duplicate Disbursement, not detect_duplicates()'s
        capped `details` sample).
    graph_snapshot: {actor_key: {"community_size": int, ...}} from the
        periodically-refreshed graph snapshot — never recomputed live
        per anomaly, per the spec's real-time scoring constraint.
    value_delta_zscore_by_actor: {actor_key: zscore} — from
        detective_service.compute_omc_risk_features() for inbound
        (indexed by omc_id there; the caller re-keys it to `customer`
        before passing it in here, since anomaly dicts only carry the
        OMC's name — see reconciliation.py's own merged_customer_col
        handling for why "name, not omc_id" is already this codebase's
        working key at the anomaly-dict level). None/absent-actor
        entries default to 0.0.
    """
    if not anomalies:
        return pd.DataFrame(columns=["anomaly_id", *FEATURE_COLUMNS])

    df = pd.DataFrame(anomalies)
    actor_keys = df.apply(actor_key, axis=1)

    zscore_lookup = value_delta_zscore_by_actor or {}

    features = pd.DataFrame({
        "anomaly_id": df["dispatch_id"],
        "flow_direction_outbound": (df.get("flow_direction") == "outbound").astype(float),
        "anomaly_type_code": df["break_type"].map(ANOMALY_TYPE_CODES).fillna(_UNKNOWN_CODE).astype(float),
        "materiality_ratio": (
            df["leakage_kes"].astype(float) / df["dispatched_kes"].clip(lower=1).astype(float)
        ),
        "value_delta_zscore": actor_keys.map(lambda k: zscore_lookup.get(k, 0.0) if k else 0.0).astype(float),
        "duplicate_flag": df.apply(lambda row: _duplicate_flag(row.to_dict(), duplicate_ids), axis=1),
        "graph_community_size": df.apply(lambda row: _graph_community_size(row.to_dict(), graph_snapshot), axis=1),
        "actor_historical_anomaly_rate": _actor_historical_anomaly_rate(actor_keys),
        "aging_days": df["age_days"].astype(float),
        "severity_tier_code": df["status"].map(SEVERITY_TIER_CODES).fillna(_UNKNOWN_CODE).astype(float),
    })

    # NaN/inf can't reach XGBoost's scale_pos_weight math or Isolation
    # Forest cleanly (e.g. materiality_ratio on a zero-dispatched_kes
    # edge case, or an actor_key of None) — replace rather than let a
    # single malformed row silently poison a whole training/scoring
    # batch.
    features[FEATURE_COLUMNS] = features[FEATURE_COLUMNS].replace([np.inf, -np.inf], 0.0).fillna(0.0)

    return features


# =============================================================================
# Context gathering — shared by train_fraud_model.py and
# fraud_scoring_service.py so duplicate_ids/value_delta_zscore_by_actor are
# computed the same way in both places (same "no drift" requirement as the
# feature table itself). Graph snapshot context comes from
# graph_snapshot_service.get_snapshot() directly — both callers use that
# the same way already, no extra wrapper needed here.
# =============================================================================

def gather_inbound_context(dispatches_df: pd.DataFrame, invoices_df: pd.DataFrame, engine) -> dict:
    """{"duplicate_ids": set, "value_delta_zscore_by_actor": dict} for
    inbound anomalies. duplicate_ids covers both a duplicated dispatch_id
    itself and a dispatch whose invoice was duplicated (dispatch_id has
    no own "Duplicate" break_type in the reconciliation engine — this is
    the closest equivalent, resolved back to the anomaly's own natural
    key). value_delta_zscore_by_actor re-keys detective_service.
    compute_omc_risk_features()'s omc_id-indexed result to `customer`
    (the OMC's name) — the key anomaly dicts and calculate_omc_risk()
    already use, since neither carries omc_id directly (see
    reconciliation.py's merged_customer_col handling)."""
    from app.services.fraud import detective_service

    duplicate_ids = set()
    if {'dispatch_id'}.issubset(dispatches_df.columns):
        duplicate_ids |= set(dispatches_df[dispatches_df.duplicated(subset=['dispatch_id'], keep=False)]['dispatch_id'])
    if {'invoice_id', 'dispatch_id'}.issubset(invoices_df.columns):
        dup_invoices = invoices_df[invoices_df.duplicated(subset=['invoice_id'], keep=False)]
        duplicate_ids |= set(dup_invoices['dispatch_id'].dropna())

    value_delta_zscore_by_actor = {}
    try:
        omc_features = detective_service.compute_omc_risk_features(engine)
        omcs = pd.read_sql("SELECT omc_id, customer_name FROM omcs", engine)
        name_by_omc_id = dict(zip(omcs['omc_id'], omcs['customer_name']))
        for omc_id, row in omc_features.iterrows():
            name = name_by_omc_id.get(omc_id)
            zscore = row.get('value_delta_zscore')
            if name and pd.notna(zscore):
                value_delta_zscore_by_actor[name] = float(zscore)
    except Exception:
        pass  # value_delta_zscore defaults to 0.0 for every actor — see module docstring's "Known gap"

    return {"duplicate_ids": duplicate_ids, "value_delta_zscore_by_actor": value_delta_zscore_by_actor}


def gather_outbound_context(
    attendance_df: pd.DataFrame,
    authorizations_df: pd.DataFrame,
    disbursements_df: pd.DataFrame,
) -> dict:
    """{"duplicate_ids": set, "value_delta_zscore_by_actor": {}} for
    outbound anomalies. duplicate_ids covers a duplicated attendance_id,
    an authorization whose attendance_id was duplicated, and a
    disbursement sharing a beneficiary+period key with another (the same
    composite-key technique run_outbound_reconciliation_on_dataframes()
    already uses for Duplicate Disbursement). value_delta_zscore_by_actor
    is always {} — no outbound equivalent of detective_service.py exists
    yet, see feature_builder.py's module docstring "Known gap"."""
    duplicate_ids = set()
    if 'attendance_id' in attendance_df.columns:
        duplicate_ids |= set(attendance_df[attendance_df.duplicated(subset=['attendance_id'], keep=False)]['attendance_id'])
    if {'authorization_id', 'attendance_id'}.issubset(authorizations_df.columns):
        dup_auth = authorizations_df[authorizations_df.duplicated(subset=['authorization_id'], keep=False)]
        duplicate_ids |= set(dup_auth['attendance_id'].dropna())
    if {'beneficiary_id', 'period', 'disbursement_id'}.issubset(disbursements_df.columns):
        keyed = disbursements_df.assign(
            _key=disbursements_df['beneficiary_id'].astype(str) + '_' + disbursements_df['period'].astype(str)
        )
        dup_disb = keyed[keyed.duplicated(subset=['_key'], keep=False)]
        duplicate_ids |= set(dup_disb['disbursement_id'].dropna())

    return {"duplicate_ids": duplicate_ids, "value_delta_zscore_by_actor": {}}
