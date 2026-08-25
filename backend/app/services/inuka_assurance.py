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
        "beneficiary_name": None,
        "identity_status": "unresolved" if beneficiary_id else "not_applicable",
        "officer_id": officer_id,
        "officer_name": None,
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


def build_inuka_cases(materiality: float = 0, *, include_sensitive: bool = False) -> dict[str, Any]:
    """Build an explainable, stable case list from the outbound source data."""
    result = run_outbound_reconciliation(materiality=materiality)
    cases: list[dict[str, Any]] = []
    seen: set[str] = set()

    beneficiaries = _records("beneficiaries")
    officers = _records("officers")
    attendance = _records("attendance")
    authorizations = _records("stipend_authorizations")
    disbursements = _records("disbursements")

    beneficiary_ids = set(beneficiaries.get("beneficiary_id", pd.Series(dtype=str)).dropna().astype(str))
    active_by_beneficiary = {
        str(row.beneficiary_id): bool(row.is_active)
        for row in beneficiaries.itertuples()
        if hasattr(row, "beneficiary_id")
    }

    beneficiary_names = {
        str(row.beneficiary_id): _text(getattr(row, "beneficiary_name", None))
        for row in beneficiaries.itertuples()
        if hasattr(row, "beneficiary_id")
    }
    officer_names = {
        str(row.officer_id): _text(getattr(row, "officer_name", None))
        for row in officers.itertuples()
        if hasattr(row, "officer_id")
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

    ordered = _group_cases(cases, disbursements, authorizations, attendance)
    if include_sensitive:
        for item in ordered:
            beneficiary_id = item.get("beneficiary_id")
            officer_id = item.get("officer_id")
            item["beneficiary_name"] = beneficiary_names.get(str(beneficiary_id)) if beneficiary_id else None
            item["identity_status"] = "verified" if item["beneficiary_name"] else ("missing_master_record" if beneficiary_id else "not_applicable")
    by_type = defaultdict(int)
    for item in ordered:
        for signal in item["signals"]:
            by_type[signal["label"]] += 1

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
_SIGNAL_WEIGHTS = {
    "ghost_beneficiary": 98,
    "ghost_payment": 95,
    "duplicate_payment": 92,
    "overpayment": 90,
    "inactive_beneficiary": 88,
    "missing_authorization": 82,
    "missing_disbursement": 78,
    "underpayment": 72,
    "shared_payment_account": 70,
    "weak_participation_evidence": 62,
}
_CONFIDENCE_RANK = {"low": 1, "medium": 2, "high": 3}


def _signal_score(signal: dict[str, Any]) -> int:
    return _SIGNAL_WEIGHTS.get(signal.get("risk_type", ""), 50)


def _case_group_key(case: dict[str, Any], disbursements: pd.DataFrame,
                    authorizations: pd.DataFrame, attendance: pd.DataFrame) -> tuple[str, str | None]:
    source_ids = {str(value) for value in case.get("source_records", []) if value}
    disb_ids = set(disbursements.get("disbursement_id", pd.Series(dtype=str)).dropna().astype(str))
    direct = sorted(source_ids & disb_ids)
    if direct:
        return f"DISB:{direct[0]}", direct[0]

    attendance_ids = set(attendance.get("attendance_id", pd.Series(dtype=str)).dropna().astype(str))
    attendance_id = next(iter(source_ids & attendance_ids), None)
    auth_ids = set(authorizations.get("authorization_id", pd.Series(dtype=str)).dropna().astype(str))
    auth_id = next((str(value) for value in source_ids if str(value) in auth_ids), None)
    if attendance_id and "attendance_id" in authorizations.columns:
        rows = authorizations[authorizations["attendance_id"].astype(str) == attendance_id]
        if not rows.empty and "authorization_id" in rows.columns:
            auth_id = _text(rows.iloc[0].get("authorization_id"))
    if auth_id and "authorization_id" in disbursements.columns:
        rows = disbursements[disbursements["authorization_id"].astype(str) == auth_id]
        if not rows.empty and "disbursement_id" in rows.columns:
            primary = _text(rows.iloc[0].get("disbursement_id"))
            if primary:
                return f"DISB:{primary}", primary

    beneficiary_id = case.get("beneficiary_id")
    period = case.get("period")
    if attendance_id and (not beneficiary_id or not period) and "attendance_id" in attendance.columns:
        attendance_rows = attendance[attendance["attendance_id"].astype(str) == attendance_id]
        if not attendance_rows.empty:
            beneficiary_id = beneficiary_id or _text(attendance_rows.iloc[0].get("beneficiary_id"))
            period = period or _text(attendance_rows.iloc[0].get("period"))
    if beneficiary_id and period and {"beneficiary_id", "period", "disbursement_id"}.issubset(disbursements.columns):
        rows = disbursements[
            (disbursements["beneficiary_id"].astype(str) == str(beneficiary_id))
            & (disbursements["period"].astype(str) == str(period))
        ]
        if not rows.empty:
            primary = _text(rows.iloc[0].get("disbursement_id"))
            if primary:
                return f"DISB:{primary}", primary

    if attendance_id:
        return f"ATT:{attendance_id}", attendance_id
    if beneficiary_id:
        return f"BEN:{beneficiary_id}:{period or 'unknown'}", None
    return f"SIGNAL:{case['case_id']}", None


def _group_cases(cases: list[dict[str, Any]], disbursements: pd.DataFrame,
                 authorizations: pd.DataFrame, attendance: pd.DataFrame) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for signal in cases:
        key, primary_record_id = _case_group_key(signal, disbursements, authorizations, attendance)
        case_reference = primary_record_id or key.replace(":", "-")
        group = grouped.setdefault(key, {
            "case_id": f"INUKA-{case_reference}",
            "primary_record_id": primary_record_id,
            "signals": [],
            "source_records": [],
            "beneficiary_id": signal.get("beneficiary_id"),
            "officer_id": signal.get("officer_id"),
            "pillar_id": signal.get("pillar_id"),
            "program_id": signal.get("program_id"),
            "period": signal.get("period"),
            "status": "Open",
            "review_status": "Open",
        })
        group["signals"].append({
            "risk_type": signal["risk_type"],
            "label": signal["title"],
            "reason": signal["reason"],
            "amount_at_risk": signal["amount_at_risk"],
            "severity": signal["severity"],
            "confidence": signal["confidence"],
            "source_records": signal["source_records"],
        })
        group["source_records"] = sorted(set(group["source_records"]) | set(signal.get("source_records", [])))
        for field in ("beneficiary_id", "officer_id", "pillar_id", "program_id", "period"):
            if not group.get(field) and signal.get(field):
                group[field] = signal[field]

    result: list[dict[str, Any]] = []
    severity_rank = {"Critical": 3, "Review Required": 2, "Pending": 1}
    for group in grouped.values():
        signals = group.pop("signals")
        signals.sort(key=lambda item: (_signal_score(item), item["amount_at_risk"]), reverse=True)
        max_score = max((_signal_score(item) for item in signals), default=50)
        score = min(100, max_score + min(10, max(0, (len(signals) - 1) * 3)))
        confidence = max((item["confidence"] for item in signals), key=lambda value: _CONFIDENCE_RANK.get(value, 0), default="low")
        severity = max((item["severity"] for item in signals), key=lambda value: severity_rank.get(value, 0), default="Review Required")
        group.update({
            "risk_type": "grouped_outbound_case",
            "title": "Outbound payment case",
            "reason": f"{len(signals)} control signal{'s' if len(signals) != 1 else ''} require review.",
            "signal_types": [item["label"] for item in signals],
            "amount_at_risk": max((item["amount_at_risk"] for item in signals), default=0),
            "risk_score": score,
            "fraud_score": score,
            "fraud_tier": "Likely Fraud" if score >= 90 else ("Suspicious" if score >= 70 else "Likely Benign"),
            "score_basis": [item["label"] for item in signals],
            "severity": severity,
            "confidence": confidence,
            "identity_status": "unresolved" if group.get("beneficiary_id") else "not_applicable",
            "beneficiary_name": None,
            "officer_name": None,
            "signals": signals,
        })
        result.append(group)
    return sorted(result, key=lambda item: (item["risk_score"], item["amount_at_risk"]), reverse=True)
