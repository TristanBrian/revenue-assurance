"""
Tests for services/fraud/feature_builder.py — the fraud scoring layer's
shared feature logic, used identically by scripts/train_fraud_model.py
and services/fraud/fraud_scoring_service.py.

Pure-function tests only: no DB, no trained model files, no network —
these should stay fast and deterministic regardless of local environment
state (unlike test_anchor_service.py/a hypothetical fraud-scoring-service
test, which depend on real credentials/trained-model-file presence being
absent to exercise their "not configured" paths).

Run with: pytest tests/test_feature_builder.py -v
"""
import os
import sys

import pandas as pd
import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.fraud.feature_builder import (  # noqa: E402
    FEATURE_COLUMNS,
    actor_key,
    build_feature_table,
)


def _inbound_anomaly(**overrides) -> dict:
    base = dict(
        dispatch_id="DISP-001", invoice_id="INV-001", customer="TotalEnergies",
        product="Diesel", dispatched_kes=1000000, invoiced_kes=1000000, paid_kes=500000,
        leakage_kes=500000, break_type="Underpayment", status="Pending", age_days=10,
        flow_direction="inbound",
    )
    base.update(overrides)
    return base


def _outbound_anomaly(**overrides) -> dict:
    base = dict(
        dispatch_id="ATT-001", invoice_id="AUTH-001", customer="Jane Wanjiru",
        product="Scholarship", dispatched_kes=20000, invoiced_kes=20000, paid_kes=0,
        leakage_kes=20000, break_type="Missing Disbursement", status="Critical", age_days=5,
        flow_direction="outbound", officer_id="OFF-001", beneficiary_id="BEN-001",
    )
    base.update(overrides)
    return base


class TestActorKey:
    def test_inbound_uses_customer_name(self):
        assert actor_key(_inbound_anomaly()) == "TotalEnergies"

    def test_outbound_uses_officer_id_not_beneficiary_id(self):
        a = _outbound_anomaly()
        assert actor_key(a) == "OFF-001"

    def test_returns_none_when_no_actor_resolvable(self):
        """Ghost payments carry officer_id=None (no real authorization to
        trace an officer through) — actor_key() must return None, not
        raise or fall back to something misleading."""
        a = _outbound_anomaly(officer_id=None, break_type="Ghost Payment")
        assert actor_key(a) is None


class TestBuildFeatureTable:
    def test_empty_input_returns_empty_frame_with_right_columns(self):
        df = build_feature_table([])
        assert list(df.columns) == ["anomaly_id", *FEATURE_COLUMNS]
        assert len(df) == 0

    def test_one_row_per_anomaly_same_order(self):
        anomalies = [_inbound_anomaly(dispatch_id="DISP-001"), _outbound_anomaly(dispatch_id="ATT-002")]
        df = build_feature_table(anomalies)
        assert list(df["anomaly_id"]) == ["DISP-001", "ATT-002"]

    def test_flow_direction_outbound_one_hot(self):
        df = build_feature_table([_inbound_anomaly(), _outbound_anomaly()])
        assert df["flow_direction_outbound"].tolist() == [0.0, 1.0]

    def test_materiality_ratio_uses_dispatched_kes_floor_of_one(self):
        """A ghost payment's dispatched_kes (eligible_kes) is 0 — clip(lower=1)
        avoids a division by zero, and the resulting large ratio is a
        legitimate signal (unbounded leakage relative to ~nothing
        expected), not something to suppress."""
        a = _outbound_anomaly(dispatched_kes=0, leakage_kes=15000, break_type="Ghost Payment")
        df = build_feature_table([a])
        assert df["materiality_ratio"].iloc[0] == 15000.0

    def test_duplicate_disbursement_break_type_always_flagged(self):
        a = _outbound_anomaly(break_type="Duplicate Disbursement")
        df = build_feature_table([a])  # no duplicate_ids passed at all
        assert df["duplicate_flag"].iloc[0] == 1.0

    def test_duplicate_ids_set_flags_matching_anomaly(self):
        a = _inbound_anomaly(dispatch_id="DISP-042")
        df = build_feature_table([a], duplicate_ids={"DISP-042"})
        assert df["duplicate_flag"].iloc[0] == 1.0

        df2 = build_feature_table([a], duplicate_ids={"DISP-999"})
        assert df2["duplicate_flag"].iloc[0] == 0.0

    def test_graph_community_size_looked_up_by_actor_key(self):
        a = _inbound_anomaly(customer="Vivo Energy")
        snapshot = {"Vivo Energy": {"community_id": 2, "community_size": 7}}
        df = build_feature_table([a], graph_snapshot=snapshot)
        assert df["graph_community_size"].iloc[0] == 7.0

    def test_graph_community_size_zero_when_actor_not_in_snapshot(self):
        a = _inbound_anomaly(customer="Unknown Corp")
        snapshot = {"Vivo Energy": {"community_id": 2, "community_size": 7}}
        df = build_feature_table([a], graph_snapshot=snapshot)
        assert df["graph_community_size"].iloc[0] == 0.0

    def test_value_delta_zscore_looked_up_by_actor_key(self):
        a = _inbound_anomaly(customer="Kobil")
        df = build_feature_table([a], value_delta_zscore_by_actor={"Kobil": 2.5})
        assert df["value_delta_zscore"].iloc[0] == 2.5

    def test_actor_historical_anomaly_rate_is_percentile_not_raw_ratio(self):
        """Regression test for a real bug found via a live entity-aware
        training run: max-normalizing this feature (count / max_count)
        made its numeric scale specific to whichever actor happened to
        hold the batch's single highest count, so the model couldn't
        generalize to unseen actors (precision/recall both landed at
        exactly 0 despite a meaningfully-above-baseline average
        precision). Percentile rank fixed it — verify the actor with the
        most anomalies gets percentile 1.0, not an arbitrary ratio."""
        anomalies = (
            [_inbound_anomaly(customer="A", dispatch_id=f"D-A{i}") for i in range(5)]
            + [_inbound_anomaly(customer="B", dispatch_id=f"D-B{i}") for i in range(2)]
            + [_inbound_anomaly(customer="C", dispatch_id="D-C0")]
        )
        df = build_feature_table(anomalies)
        df["actor"] = [a["customer"] for a in anomalies]
        rates_by_actor = df.groupby("actor")["actor_historical_anomaly_rate"].first()
        # A has the most anomalies (5) -> top percentile.
        assert rates_by_actor["A"] == 1.0
        # Rates are monotonic with anomaly count: A > B > C.
        assert rates_by_actor["A"] > rates_by_actor["B"] > rates_by_actor["C"]

    def test_no_nan_or_inf_in_output(self):
        """A malformed row (no actor, zero dispatched_kes, missing
        break_type mapping) must never poison the whole batch with NaN/
        inf — these break XGBoost/Isolation Forest outright."""
        a = _outbound_anomaly(officer_id=None, dispatched_kes=0, break_type="Some New Break Type")
        df = build_feature_table([a])
        assert not df[FEATURE_COLUMNS].isna().any().any()
        assert not df[FEATURE_COLUMNS].isin([float("inf"), float("-inf")]).any().any()

    def test_unknown_break_type_and_status_get_sentinel_code_not_error(self):
        a = _inbound_anomaly(break_type="Totally New Type", status="Totally New Status")
        df = build_feature_table([a])
        assert df["anomaly_type_code"].iloc[0] == -1.0
        assert df["severity_tier_code"].iloc[0] == -1.0
