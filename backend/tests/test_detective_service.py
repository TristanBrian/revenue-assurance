"""
Tests for services/detective_service.py.

Uses an in-memory SQLite engine (via to_sql) rather than DataFrame-only
fixtures like test_reconciliation.py, since compute_omc_risk_features()
takes an engine and reads tables via pd.read_sql — this exercises the real
function against a real (if tiny) DB rather than a refactored variant.

Run with: pytest tests/test_detective_service.py -v
"""
import os
import sys

import pandas as pd
import pytest
from sqlalchemy import create_engine

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.detective_service import (
    compute_omc_risk_features,
    get_all_omc_risk_features,
    get_omc_risk,
)


@pytest.fixture
def engine():
    eng = create_engine("sqlite:///:memory:")

    omcs = pd.DataFrame(
        {
            "omc_id": ["OMC-A", "OMC-B", "OMC-C", "OMC-EMPTY"],
            "customer_name": ["Alpha Energy", "Beta Fuels", "Gamma Oil", "Empty Co"],
            "kra_pin": ["P111", "P222", "P444", "P333"],
        }
    )

    # OMC-A: one ghost load (DISP-2, no invoice), one clean matched chain
    # (DISP-1 -> INV-1 -> PAY-1), one product mismatch (DISP-3 -> INV-3
    # with a different product).
    # OMC-B: one invoice with no payment (unmatched_payment_rate), no
    # matched chain at all.
    # OMC-C: one clean matched chain (DISP-5 -> INV-5 -> PAY-2) — exists
    # purely so value_delta_zscore has 2 OMCs with a chain to compute a
    # population std against (a std needs >=2 points; with only OMC-A
    # having one, every OMC correctly gets NaN, which is its own
    # legitimate case but not what this fixture is for).
    # OMC-EMPTY: zero dispatches/invoices/payments entirely — the
    # divide-by-zero case every rate/z-score feature must survive.
    dispatches = pd.DataFrame(
        {
            "dispatch_id": ["DISP-1", "DISP-2", "DISP-3", "DISP-4", "DISP-5"],
            "omc_id": ["OMC-A", "OMC-A", "OMC-A", "OMC-B", "OMC-C"],
            "date": ["2026-01-10", "2026-01-15", "2026-01-20", "2026-01-10", "2026-01-10"],
            "product": ["PMS", "AGO", "PMS", "AGO", "PMS"],
            "depot": ["Nairobi", "Nairobi", "Mombasa", "Nairobi", "Mombasa"],
            "volume_liters": [10000, 8000, 12000, 9000, 7000],
            "value_kes": [1500000, 1200000, 1800000, 1400000, 1100000],
        }
    )

    invoices = pd.DataFrame(
        {
            "invoice_id": ["INV-1", "INV-3", "INV-4", "INV-5"],
            "dispatch_id": ["DISP-1", "DISP-3", "DISP-4", "DISP-5"],
            "omc_id": ["OMC-A", "OMC-A", "OMC-B", "OMC-C"],
            "product": ["PMS", "DPK", "AGO", "PMS"],  # INV-3's product ("DPK") mismatches DISP-3's ("PMS")
            "date": ["2026-01-12", "2026-01-22", "2026-01-13", "2026-01-12"],
            "value_kes": [1500000, 1800000, 1400000, 1100000],
        }
    )

    # INV-1 (OMC-A) and INV-5 (OMC-C) get paid; INV-3 (OMC-A) and INV-4
    # (OMC-B) are unmatched.
    payments = pd.DataFrame(
        {
            "invoice_id": ["INV-1", "INV-5"],
            "total_paid_kes": [1490000, 1080000],
            "date": ["2026-01-20", "2026-01-19"],  # both ~8 days after their invoice -> aging bucket 0
        }
    )

    quota = pd.DataFrame(
        {
            "omc_id": ["OMC-A"],  # OMC-B and OMC-EMPTY deliberately have no row
            "current_quota_litres": [100000],
            "trailing_window_days": [30],
        }
    )

    omcs.to_sql("omcs", eng, index=False)
    dispatches.to_sql("dispatches", eng, index=False)
    invoices.to_sql("invoices", eng, index=False)
    payments.to_sql("payments", eng, index=False)
    quota.to_sql("quota_ledger", eng, index=False)
    return eng


def test_every_omc_present_including_zero_activity(engine):
    """OMC-EMPTY has no dispatches/invoices/payments at all — it must
    still appear in the result (not silently dropped), with NaN features
    rather than a crash."""
    df = compute_omc_risk_features(engine)
    assert set(df["omc_id"]) == {"OMC-A", "OMC-B", "OMC-C", "OMC-EMPTY"}

    empty_row = df[df["omc_id"] == "OMC-EMPTY"].iloc[0]
    assert pd.isna(empty_row["ghost_load_rate"])
    assert pd.isna(empty_row["unmatched_payment_rate"])
    assert pd.isna(empty_row["product_mismatch_rate"])
    assert pd.isna(empty_row["value_delta_zscore"])
    assert pd.isna(empty_row["depot_concentration"])
    assert pd.isna(empty_row["quota_utilization_pct"])


def test_ghost_load_rate(engine):
    df = compute_omc_risk_features(engine).set_index("omc_id")
    # OMC-A: 3 dispatches, 1 with no invoice (DISP-2) -> 1/3
    assert df.loc["OMC-A", "ghost_load_rate"] == pytest.approx(1 / 3)
    # OMC-B: 1 dispatch, has an invoice -> 0
    assert df.loc["OMC-B", "ghost_load_rate"] == pytest.approx(0.0)


def test_unmatched_payment_rate(engine):
    df = compute_omc_risk_features(engine).set_index("omc_id")
    # OMC-A: 2 invoices (INV-1, INV-3), 1 unpaid (INV-3) -> 1/2
    assert df.loc["OMC-A", "unmatched_payment_rate"] == pytest.approx(0.5)
    # OMC-B: 1 invoice (INV-4), unpaid -> 1/1
    assert df.loc["OMC-B", "unmatched_payment_rate"] == pytest.approx(1.0)


def test_product_mismatch_rate(engine):
    df = compute_omc_risk_features(engine).set_index("omc_id")
    # OMC-A: 2 dispatches with a matching invoice (DISP-1, DISP-3); DISP-3
    # mismatches ("PMS" vs "DPK") -> 1/2
    assert df.loc["OMC-A", "product_mismatch_rate"] == pytest.approx(0.5)
    # OMC-B: 1 matched dispatch (DISP-4/INV-4), same product -> 0
    assert df.loc["OMC-B", "product_mismatch_rate"] == pytest.approx(0.0)


def test_quota_utilization_null_when_no_quota_row(engine):
    df = compute_omc_risk_features(engine).set_index("omc_id")
    assert pd.isna(df.loc["OMC-B", "quota_utilization_pct"])
    assert pd.isna(df.loc["OMC-EMPTY", "quota_utilization_pct"])
    # OMC-A has a quota row and dispatch volume -> a real (non-null) number
    assert pd.notna(df.loc["OMC-A", "quota_utilization_pct"])


def test_value_delta_zscore_is_relative_not_absolute(engine):
    """z-scores are centered on the population mean, not an absolute
    threshold — OMC-A and OMC-C are the only 2 with a full matched chain,
    so their z-scores should be non-null and sum to ~0 (mean-centered)."""
    df = compute_omc_risk_features(engine).set_index("omc_id")
    zscores = df["value_delta_zscore"].dropna()
    assert len(zscores) == 2
    assert zscores.sum() == pytest.approx(0.0, abs=1e-9)


def test_get_all_omc_risk_features_matches_compute(engine):
    """Thin wrapper — same data as compute_omc_risk_features()."""
    wrapped = get_all_omc_risk_features(engine)
    direct = compute_omc_risk_features(engine)
    pd.testing.assert_frame_equal(wrapped, direct)


def test_get_omc_risk_returns_single_omc_dict(engine):
    result = get_omc_risk(engine, "OMC-A")
    assert result["omc_id"] == "OMC-A"
    assert result["ghost_load_rate"] == pytest.approx(1 / 3)


def test_get_omc_risk_raises_on_unknown_omc(engine):
    with pytest.raises(ValueError):
        get_omc_risk(engine, "OMC-DOES-NOT-EXIST")
