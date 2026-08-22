from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.dependencies import enforce_reconciliation_scope, require_permission
from app.models.auth.user import User
from app.services.inuka_assurance import beneficiary_detail, build_inuka_cases, dimension_summary

router = APIRouter()


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
