"""Explainable Inuka assurance cases over the current outbound data contract.

This service deliberately keeps the first release backward-compatible with the
existing attendance/authorization/disbursement tables. It treats reconciliation
breaks as payment-control evidence and adds identity, enrollment, timing,
account-concentration, and evidence-quality signals where the current source
columns allow them. New verified evidence tables can replace these inferred
signals without changing the API shape.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Optional

import pandas as pd

from app.services.reconciliation.reconciliation import run_outbound_reconciliation
from app.utils.db_connection import get_engine

PILLAR_LABELS = {
    "Scholarship": "Inuka Scholarship",
    "Plus": "Inuka Plus",
    "Vocational": "Vocational Training",
    "Tech": "Inuka Tech Fellowship",
}


def pillar_label(value: Any) -> Optional[str]:
    raw = _text(value)
    return PILLAR_LABELS.get(raw or "", raw)


def _records(table: str) -> pd.DataFrame:
    try:
        return pd.read_sql(f"SELECT * FROM {table}", get_engine())
    except Exception:
        return pd.DataFrame()


def _text(value: Any) -> Optional[str]:
    if value is None or pd.isna(value):
        return None
    return str(value)


def _money(value: Any) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def _case(case_id: str, risk_type: str, title: str, reason: str, *, beneficiary_id: str | None = None,
          officer_id: str | None = None, pillar_id: str | None = None, period: str | None = None,
          amount_at_risk: int = 0, risk_score: int = 50, severity: str = "Review Required",
          source_records: list[str] | None = None, confidence: str = "medium") -> dict[str, Any]:
    return {
        "case_id": case_id,
        "risk_type": risk_type,
        "title": title,
        "reason": reason,
        "beneficiary_id": beneficiary_id,
        "officer_id": officer_id,
        "pillar_id": pillar_label(pillar_id),
        "program_id": None,
        "period": period,
        "amount_at_risk": amount_at_risk,
        "risk_score": risk_score,
        "severity": severity,
        "status": "Open",
        "confidence": confidence,
        "source_records": source_records or [],
    }


def build_inuka_cases(materiality: float = 0) -> dict[str, Any]:
    """Build an explainable, stable case list from the outbound source data."""
    result = run_outbound_reconciliation(materiality=materiality)
    cases: list[dict[str, Any]] = []
    seen: set[str] = set()

    beneficiaries = _records("beneficiaries")
    attendance = _records("attendance")
    authorizations = _records("stipend_authorizations")
    disbursements = _records("disbursements")

    beneficiary_ids = set(beneficiaries.get("beneficiary_id", pd.Series(dtype=str)).dropna().astype(str))
    active_by_beneficiary = {
        str(row.beneficiary_id): bool(row.is_active)
        for row in beneficiaries.itertuples()
        if hasattr(row, "beneficiary_id")
    }

    break_mapping = {
        "Ghost Payment": ("ghost_payment", "Ghost payment", "Payment has no valid authorization."),
        "Duplicate Disbursement": ("duplicate_payment", "Duplicate payment", "The beneficiary has multiple payments in the same period."),
        "Missing Authorization": ("missing_authorization", "Missing authorization", "Participation exists without an officer-approved authorization."),
        "Missing Disbursement": ("missing_disbursement", "Missing disbursement", "An approved stipend has no matching payment."),
        "Overpayment": ("overpayment", "Overpayment", "The paid amount exceeds the authorized amount."),
        "Underpayment": ("underpayment", "Underpayment", "The paid amount is below the authorized amount."),
    }
    for anomaly in result.get("anomalies", []):
        break_type = anomaly.get("break_type", "Unknown")
        risk_type, title, reason = break_mapping.get(break_type, ("reconciliation_break", break_type, "A reconciliation control failed."))
        case_id = f"RECON-{anomaly.get('dispatch_id')}-{risk_type}"
        if case_id in seen:
            continue
        seen.add(case_id)
        cases.append(_case(
            case_id, risk_type, title, reason,
            beneficiary_id=_text(anomaly.get("beneficiary_id")),
            officer_id=_text(anomaly.get("officer_id")),
            pillar_id=_text(anomaly.get("product")) or _text(anomaly.get("customer")),
            period=None,
            amount_at_risk=_money(anomaly.get("leakage_kes")),
            risk_score=95 if break_type in {"Ghost Payment", "Duplicate Disbursement", "Overpayment"} else 80,
            severity="Critical" if anomaly.get("status") == "Critical" else "Review Required",
            source_records=[x for x in [anomaly.get("dispatch_id"), anomaly.get("invoice_id")] if x],
            confidence="high",
        ))

    # Payments without a beneficiary master record are ghost-beneficiary
    # cases, even when a payment happens to carry an authorization id.
    if not disbursements.empty and "beneficiary_id" in disbursements:
        for row in disbursements.itertuples():
            beneficiary_id = _text(getattr(row, "beneficiary_id", None))
            if beneficiary_id and beneficiary_id not in beneficiary_ids:
                case_id = f"IDENTITY-GHOST-{getattr(row, 'disbursement_id', beneficiary_id)}"
                cases.append(_case(case_id, "ghost_beneficiary", "Ghost beneficiary", "Payment references a beneficiary absent from the verified beneficiary registry.", beneficiary_id=beneficiary_id, pillar_id=_text(getattr(row, "pillar_id", None)), period=_text(getattr(row, "period", None)), amount_at_risk=_money(getattr(row, "amount_paid", 0)), risk_score=98, severity="Critical", source_records=[_text(getattr(row, "disbursement_id", None))] if getattr(row, "disbursement_id", None) else [], confidence="high"))

            if beneficiary_id and active_by_beneficiary.get(beneficiary_id) is False:
                case_id = f"ELIGIBILITY-INACTIVE-{getattr(row, 'disbursement_id', beneficiary_id)}"
                cases.append(_case(case_id, "inactive_beneficiary", "Inactive beneficiary paid", "A payment was made after the beneficiary was marked inactive.", beneficiary_id=beneficiary_id, pillar_id=_text(getattr(row, "pillar_id", None)), period=_text(getattr(row, "period", None)), amount_at_risk=_money(getattr(row, "amount_paid", 0)), risk_score=90, severity="Critical", source_records=[_text(getattr(row, "disbursement_id", None))] if getattr(row, "disbursement_id", None) else [], confidence="high"))

    # Shared payment accounts are retained as a supporting signal, not a
    # verdict. Legitimate guardians or household arrangements need review.
    if not disbursements.empty and {"disbursing_account", "beneficiary_id"}.issubset(disbursements.columns):
        grouped = disbursements.dropna(subset=["disbursing_account", "beneficiary_id"]).groupby("disbursing_account")
        for account, group in grouped:
            ids = sorted(set(group["beneficiary_id"].astype(str)))
            if len(ids) < 2:
                continue
            total = _money(group["amount_paid"].sum()) if "amount_paid" in group else 0
            for beneficiary_id in ids:
                case_id = f"ACCOUNT-SHARED-{account}-{beneficiary_id}"
                cases.append(_case(case_id, "shared_payment_account", "Shared payment account", f"{len(ids)} beneficiary records route payments to the same account; confirm household or program justification.", beneficiary_id=beneficiary_id, pillar_id=_text(group.iloc[0].get("pillar_id")), amount_at_risk=total, risk_score=72, severity="Review Required", source_records=group.get("disbursement_id", pd.Series(dtype=str)).astype(str).tolist(), confidence="medium"))

    # Weak or late participation evidence is surfaced separately from cash
    # leakage so managers can improve source controls without overclaiming fraud.
    if not attendance.empty and "beneficiary_id" in attendance.columns:
        for row in attendance.itertuples():
            status = _text(getattr(row, "status", None))
            if status and status.lower() not in {"verified", "approved", "confirmed"}:
                attendance_id = _text(getattr(row, "attendance_id", None)) or "unknown"
                cases.append(_case(f"EVIDENCE-STATUS-{attendance_id}", "weak_participation_evidence", "Participation evidence not verified", f"Attendance status is {status}; an independent verification is required before payout.", beneficiary_id=_text(getattr(row, "beneficiary_id", None)), officer_id=_text(getattr(row, "officer_id", None)), pillar_id=_text(getattr(row, "pillar_id", None)), period=_text(getattr(row, "period", None)), risk_score=65, severity="Review Required", source_records=[attendance_id], confidence="low"))

    # Deduplicate generated cases by id while preserving highest exposure.
    unique: dict[str, dict[str, Any]] = {}
    for item in cases:
        prior = unique.get(item["case_id"])
        if prior is None or item["risk_score"] > prior["risk_score"]:
            unique[item["case_id"]] = item
    ordered = sorted(unique.values(), key=lambda x: (x["risk_score"], x["amount_at_risk"]), reverse=True)
    by_type = defaultdict(int)
    for item in ordered:
        by_type[item["risk_type"]] += 1

    return {
        "cases": ordered,
        "summary": {
            "case_count": len(ordered),
            "critical_count": sum(1 for x in ordered if x["severity"] == "Critical"),
            "review_count": sum(1 for x in ordered if x["severity"] == "Review Required"),
            "amount_at_risk": sum(x["amount_at_risk"] for x in ordered),
            "by_type": dict(by_type),
            "generated_at": datetime.utcnow().isoformat() + "Z",
        },
    }


def beneficiary_detail(beneficiary_id: str) -> dict[str, Any] | None:
    beneficiaries = _records("beneficiaries")
    if beneficiaries.empty or "beneficiary_id" not in beneficiaries.columns:
        return None
    match = beneficiaries[beneficiaries["beneficiary_id"].astype(str) == beneficiary_id]
    if match.empty:
        return None
    result = match.iloc[0].where(pd.notna(match.iloc[0]), None).to_dict()
    for table, key in (("attendance", "beneficiary_id"), ("stipend_authorizations", "beneficiary_id"), ("disbursements", "beneficiary_id")):
        frame = _records(table)
        if not frame.empty and key in frame.columns:
            rows = frame[frame[key].astype(str) == beneficiary_id].where(pd.notna(frame), None).to_dict(orient="records")
            result[table] = rows
        else:
            result[table] = []
    result["cases"] = [x for x in build_inuka_cases(materiality=0)["cases"] if x.get("beneficiary_id") == beneficiary_id]
    return result


def dimension_summary(dimension: str) -> list[dict[str, Any]]:
    cases = build_inuka_cases(materiality=0)["cases"]
    key = "pillar_id" if dimension == "pillars" else "officer_id"
    grouped: dict[str, dict[str, Any]] = {}
    for item in cases:
        value = item.get(key) or "Unassigned"
        row = grouped.setdefault(value, {"id": value, "case_count": 0, "critical_count": 0, "amount_at_risk": 0})
        row["case_count"] += 1
        row["critical_count"] += item["severity"] == "Critical"
        row["amount_at_risk"] += item["amount_at_risk"]
    return sorted(grouped.values(), key=lambda x: x["amount_at_risk"], reverse=True)
