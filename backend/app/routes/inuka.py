from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import enforce_reconciliation_scope, get_db, require_permission
from app.models.auth.user import User
from app.services.audit.audit_service import get_record_audit_history, log_action
from app.services.inuka_assurance import beneficiary_detail, build_inuka_cases, dimension_summary

router = APIRouter()


class CaseActionRequest(BaseModel):
    action: str = Field(min_length=1, max_length=64)
    note: str = Field(default="", max_length=2000)


CASE_ACTIONS = {
    "acknowledge": "Case acknowledged for review",
    "request_evidence": "Supporting evidence requested",
    "add_note": "Review note added",
    "escalate": "Escalated for compliance or finance review",
}


def _user(user: User) -> User:
    enforce_reconciliation_scope(user, "outbound")
    return user


@router.get("/summary")
def inuka_summary(user: User = Depends(require_permission("view_metrics"))):
    _user(user)
    return build_inuka_cases(materiality=0)["summary"]


@router.get("/cases")
def inuka_cases(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    status: str | None = Query(None),
    risk_type: str | None = Query(None),
    pillar_id: str | None = Query(None),
    program_id: str | None = Query(None),
    officer_id: str | None = Query(None),
    period: str | None = Query(None),
    search: str | None = Query(None),
    user: User = Depends(require_permission("view_anomaly_table")),
):
    _user(user)
    result = build_inuka_cases(materiality=0)
    cases = result["cases"]
    if status:
        cases = [x for x in cases if x["status"].lower() == status.lower() or x["severity"].lower() == status.lower()]
    if risk_type:
        cases = [x for x in cases if x["risk_type"] == risk_type]
    if program_id:
        cases = [x for x in cases if x.get("program_id") == program_id]
    if pillar_id:
        cases = [x for x in cases if x.get("pillar_id") == pillar_id]
    if officer_id:
        cases = [x for x in cases if x.get("officer_id") == officer_id]
    if period:
        cases = [x for x in cases if x.get("period") == period]
    if search:
        query = search.lower()
        cases = [x for x in cases if query in " ".join(str(v or "") for v in (x.get("case_id"), x.get("title"), x.get("reason"), x.get("beneficiary_id"), x.get("officer_id"), x.get("program_id"))).lower()]
    total = len(cases)
    offset = (page - 1) * page_size
    return {"cases": cases[offset:offset + page_size], "pagination": {"page": page, "page_size": page_size, "total": total, "total_pages": (total + page_size - 1) // page_size if total else 0, "has_next": offset + page_size < total, "has_prev": page > 1}, "summary": result["summary"]}


def _find_case(case_id: str):
    return next((item for item in build_inuka_cases(materiality=0)["cases"] if item["case_id"] == case_id), None)


@router.get("/cases/{case_id}/actions")
def inuka_case_actions(
    case_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("view_anomaly_table")),
):
    _user(user)
    if _find_case(case_id) is None:
        raise HTTPException(status_code=404, detail="Assurance case not found")
    history = get_record_audit_history(db, target_type="inuka_case", target_id=case_id)
    return {
        "actions": [
            {
                "id": str(item.id),
                "action": item.action.removeprefix("inuka_case."),
                "note": (item.after_value or {}).get("note", "") if item.after_value else "",
                "created_at": item.created_at.isoformat(),
                "actor_user_id": str(item.actor_user_id) if item.actor_user_id else None,
            }
            for item in history
            if item.action.startswith("inuka_case.")
        ]
    }


@router.post("/cases/{case_id}/actions")
def create_inuka_case_action(
    case_id: str,
    payload: CaseActionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("view_anomaly_table")),
):
    _user(user)
    case = _find_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Assurance case not found")
    if payload.action not in CASE_ACTIONS:
        raise HTTPException(status_code=400, detail="Unsupported case action")
    entry = log_action(
        db,
        actor_user_id=user.id,
        action=f"inuka_case.{payload.action}",
        target_type="inuka_case",
        target_id=case_id,
        after={"note": payload.note, "label": CASE_ACTIONS[payload.action]},
        metadata={"pillar_id": case.get("pillar_id"), "risk_type": case.get("risk_type")},
    )
    db.commit()
    return {
        "id": str(entry.id),
        "action": payload.action,
        "label": CASE_ACTIONS[payload.action],
        "note": payload.note,
        "created_at": entry.created_at.isoformat(),
    }


@router.get("/beneficiaries/{beneficiary_id}")
def inuka_beneficiary(beneficiary_id: str, user: User = Depends(require_permission("view_anomaly_table"))):
    _user(user)
    detail = beneficiary_detail(beneficiary_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Beneficiary not found")
    return detail


@router.get("/pillars")
def inuka_pillars(user: User = Depends(require_permission("view_metrics"))):
    _user(user)
    return {"items": dimension_summary("pillars"), "dimension": "pillar"}


@router.get("/officers")
def inuka_officers(user: User = Depends(require_permission("view_metrics"))):
    _user(user)
    return {"items": dimension_summary("officers")}
