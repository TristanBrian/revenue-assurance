"""
detective_service.py — statistical/EDA risk-feature layer.

Follows the raw-SQL/pandas pattern used in services/reconciliation.py
(pd.read_sql against the engine from app.utils.db_connection). NO networkx
import, no graph concepts — this file must be usable completely
standalone; an analyst calling these functions/endpoints should never need
to know a graph feature exists. graph_engine.py imports FROM this file,
never the reverse.

No caching/background-job infrastructure here — synchronous computation
only. If this proves slow against real dataset size, a response cache
similar to services/feed.py's in-memory pattern is a reasonable follow-up,
but it isn't built speculatively here.
"""
from typing import Optional

import numpy as np
import pandas as pd


def _load_tables(engine):
    omcs = pd.read_sql("SELECT omc_id FROM omcs", engine)
    dispatches = pd.read_sql(
        "SELECT dispatch_id, omc_id, date, product, depot, volume_liters, value_kes FROM dispatches", engine
    )
    invoices = pd.read_sql(
        "SELECT invoice_id, dispatch_id, omc_id, product, date, value_kes FROM invoices", engine
    )
    # payments is raw, one row per installment (payment_id, invoice_id,
    # value_kes, date, ...) — no total_paid_kes column, unlike the old ETL
    # this was originally written against. Aggregate to one row per
    # invoice_id here (sum of installments, latest payment date), same
    # shape/semantics services/reconciliation.py's own fallback aggregation
    # produces, so ghost/aging/z-score logic below is unaffected by this.
    raw_payments = pd.read_sql("SELECT invoice_id, value_kes, date FROM payments", engine)
    payments = raw_payments.groupby("invoice_id", as_index=False).agg(
        total_paid_kes=("value_kes", "sum"),
        date=("date", "max"),
    )
    # quota_ledger is Alembic-managed, not ETL-managed (see alembic/env.py) —
    # it may not exist at all yet on a DB where migrations haven't been run
    # (fresh/scratch/test environments). Missing rows within an existing
    # table already degrade quota_utilization_pct to NaN by design; a
    # missing table entirely must degrade the same way, not crash every
    # other feature in this function.
    try:
        quota = pd.read_sql("SELECT omc_id, current_quota_litres, trailing_window_days FROM quota_ledger", engine)
    except Exception:
        quota = pd.DataFrame(columns=["omc_id", "current_quota_litres", "trailing_window_days"])

    dispatches["date"] = pd.to_datetime(dispatches["date"])
    invoices["date"] = pd.to_datetime(invoices["date"])
    payments["date"] = pd.to_datetime(payments["date"])
    return omcs, dispatches, invoices, payments, quota


def _shannon_entropy(volume_by_depot: pd.Series) -> float:
    """Shannon entropy (base 2) of a volume distribution across depots.
    Higher = more spread across depots ("depot-shopping"); 0 = all volume
    through a single depot. NaN if there's no volume to compute over."""
    total = volume_by_depot.sum()
    if total <= 0:
        return np.nan
    p = volume_by_depot / total
    p = p[p > 0]
    return float(-(p * np.log2(p)).sum())


def compute_omc_risk_features(engine) -> pd.DataFrame:
    """One row per OMC (from omcs — every OMC appears even with zero
    dispatches/invoices/payments; affected features are NaN for that OMC,
    never a divide-by-zero crash)."""
    omcs, dispatches, invoices, payments, quota = _load_tables(engine)
    result = pd.DataFrame(index=pd.Index(omcs["omc_id"], name="omc_id"))

    # --- ghost_load_rate: % of this OMC's dispatches with no matching invoice ---
    disp_has_invoice = dispatches.merge(
        invoices[["dispatch_id"]].drop_duplicates(), on="dispatch_id", how="left", indicator=True
    )
    ghost = disp_has_invoice.groupby("omc_id")["_merge"].apply(lambda s: (s == "left_only").mean())
    result["ghost_load_rate"] = ghost.reindex(result.index)

    # --- unmatched_payment_rate: % of this OMC's invoices with no matching payment ---
    # payments is already aggregated one-row-per-invoice_id by the ETL pipeline.
    inv_has_payment = invoices.merge(
        payments[["invoice_id"]].drop_duplicates(), on="invoice_id", how="left", indicator=True
    )
    unmatched = inv_has_payment.groupby("omc_id")["_merge"].apply(lambda s: (s == "left_only").mean())
    result["unmatched_payment_rate"] = unmatched.reindex(result.index)

    # --- product_mismatch_rate: dispatch.product != invoice.product, over
    # dispatches that DO have a matching invoice — a missing invoice is
    # already counted by ghost_load_rate above, not double-counted here. ---
    matched = dispatches.merge(
        invoices[["dispatch_id", "product"]], on="dispatch_id", how="inner", suffixes=("_disp", "_inv")
    )
    if not matched.empty:
        mismatch_rate = (matched["product_disp"] != matched["product_inv"]).groupby(matched["omc_id"]).mean()
    else:
        mismatch_rate = pd.Series(dtype=float)
    result["product_mismatch_rate"] = mismatch_rate.reindex(result.index)

    # --- value_delta_zscore ---
    # Only computed over the full dispatch -> invoice -> payment chain (a
    # missing invoice/payment leg is already captured by ghost_load_rate /
    # unmatched_payment_rate, not re-counted here). delta per dispatch =
    # |dispatched - invoiced| + |invoiced - paid|; take each OMC's mean
    # delta, then z-score THAT against the distribution of per-OMC means
    # across all OMCs — relative, not a fixed threshold, since OMC
    # transaction volumes vary too much by size for an absolute cutoff to
    # mean anything.
    chain = (
        dispatches.merge(
            invoices[["dispatch_id", "invoice_id", "value_kes"]],
            on="dispatch_id",
            how="inner",
            suffixes=("_disp", "_inv"),
        ).merge(payments[["invoice_id", "total_paid_kes"]], on="invoice_id", how="inner")
    )
    if not chain.empty:
        delta = (chain["value_kes_disp"] - chain["value_kes_inv"]).abs() + (
            chain["value_kes_inv"] - chain["total_paid_kes"]
        ).abs()
        omc_mean_delta = delta.groupby(chain["omc_id"]).mean()
    else:
        omc_mean_delta = pd.Series(dtype=float)
    omc_mean_delta = omc_mean_delta.reindex(result.index)
    pop_mean, pop_std = omc_mean_delta.mean(), omc_mean_delta.std()
    if pop_std and pop_std > 0:
        result["value_delta_zscore"] = (omc_mean_delta - pop_mean) / pop_std
    else:
        result["value_delta_zscore"] = np.nan

    # --- depot_concentration: Shannon entropy of volume across depots,
    # overall and trailing-30d vs prior-30d (rising entropy = depot-
    # shopping signal). "Now" is the most recent dispatch date in the
    # dataset, not wall-clock time — this is historical synthetic data. ---
    overall_by_depot = dispatches.groupby(["omc_id", "depot"])["volume_liters"].sum()
    result["depot_concentration"] = overall_by_depot.groupby("omc_id").apply(_shannon_entropy).reindex(result.index)

    if not dispatches.empty:
        as_of = dispatches["date"].max()
        trailing_start = as_of - pd.Timedelta(days=30)
        prior_start = as_of - pd.Timedelta(days=60)

        trailing = dispatches[dispatches["date"] > trailing_start]
        prior = dispatches[(dispatches["date"] > prior_start) & (dispatches["date"] <= trailing_start)]

        trailing_by_depot = trailing.groupby(["omc_id", "depot"])["volume_liters"].sum()
        prior_by_depot = prior.groupby(["omc_id", "depot"])["volume_liters"].sum()

        result["depot_concentration_trailing_30d"] = (
            trailing_by_depot.groupby("omc_id").apply(_shannon_entropy).reindex(result.index)
        )
        result["depot_concentration_prior_30d"] = (
            prior_by_depot.groupby("omc_id").apply(_shannon_entropy).reindex(result.index)
        )
    else:
        result["depot_concentration_trailing_30d"] = np.nan
        result["depot_concentration_prior_30d"] = np.nan

    # --- aging_severity: days from invoice date to payment date, bucketed
    # 0-15/16-30/31-45/45+ -> score 0/0.33/0.67/1.0, averaged per OMC.
    # Only over invoices that DO have a payment (unmatched ones are
    # unmatched_payment_rate's concern, not aging). ---
    inv_pay = invoices.merge(payments[["invoice_id", "date"]], on="invoice_id", how="inner", suffixes=("_inv", "_pay"))
    if not inv_pay.empty:
        days = (inv_pay["date_pay"] - inv_pay["date_inv"]).dt.days.clip(lower=0)
        bucket_index = pd.cut(days, bins=[-1, 15, 30, 45, np.inf], labels=[0, 1, 2, 3]).astype(float)
        aging_score = (bucket_index / 3).groupby(inv_pay["omc_id"]).mean()
    else:
        aging_score = pd.Series(dtype=float)
    result["aging_severity"] = aging_score.reindex(result.index)

    # --- quota_utilization_pct: dispatch volume in the OMC's own
    # trailing_window_days / current_quota_litres, from quota_ledger
    # LEFT JOINed on omc_id. NULL (not 0, not an error) if the OMC has no
    # quota_ledger row, or if current_quota_litres is missing/zero there.
    # Small OMC count (dozens, not thousands) — a plain per-OMC loop here
    # is simpler to read correctly than vectorizing variable per-OMC
    # windows, and this isn't a hot path. ---
    quota_util = {}
    if not dispatches.empty:
        as_of = dispatches["date"].max()
        quota_by_omc = quota.set_index("omc_id")
        for omc_id in result.index:
            if omc_id not in quota_by_omc.index:
                quota_util[omc_id] = np.nan
                continue
            row = quota_by_omc.loc[omc_id]
            current_quota = row["current_quota_litres"]
            if pd.isna(current_quota) or current_quota == 0:
                quota_util[omc_id] = np.nan
                continue
            window_days = row["trailing_window_days"] if pd.notna(row["trailing_window_days"]) else 30
            window_start = as_of - pd.Timedelta(days=window_days)
            vol = dispatches[(dispatches["omc_id"] == omc_id) & (dispatches["date"] > window_start)][
                "volume_liters"
            ].sum()
            quota_util[omc_id] = (vol / current_quota) * 100
    result["quota_utilization_pct"] = pd.Series(quota_util, dtype=float).reindex(result.index)

    return result.reset_index()


def get_all_omc_risk_features(engine) -> pd.DataFrame:
    """Thin wrapper around compute_omc_risk_features() — routes call this,
    not the compute function directly, so the public service surface
    stays stable if the internals change."""
    return compute_omc_risk_features(engine)


def get_omc_risk(engine, omc_id: str) -> dict:
    """Single-OMC lookup. Raises ValueError if omc_id doesn't exist in
    omcs — routes map this to a 404."""
    features = compute_omc_risk_features(engine)
    row = features[features["omc_id"] == omc_id]
    if row.empty:
        raise ValueError(f"Unknown omc_id: {omc_id}")
    return row.iloc[0].to_dict()
