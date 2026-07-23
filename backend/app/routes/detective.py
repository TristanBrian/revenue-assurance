"""
Analyst-facing endpoints for OMC risk features — the raw statistical/EDA
findings, meant for an analyst to pull into their own tools (a notebook,
Excel, a separate plotting script), not just the built-in dashboard.

Thin routes: parse input, call one service function, return/raise. Same
convention as routes/auth.py. Gated on "view_risk_analytics", a distinct
permission from "view_fraud_graph" — this file has no graph concept, so it
shouldn't share a permission name with the graph feature (routes/graph.py).
"""
import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core.dependencies import require_permission
from app.models.user import User
from app.schemas.detective import OmcRiskFeatures
from app.services import detective_service
from app.utils.db_connection import get_engine

router = APIRouter()  # prefix="/api/detective" and tags supplied by main.py's include_router()


@router.get("/risk-features", response_model=list[OmcRiskFeatures])
async def list_risk_features(user: User = Depends(require_permission("view_risk_analytics"))):
    """The primary "give me the raw table" endpoint — every OMC's risk features."""
    df = detective_service.get_all_omc_risk_features(get_engine())
    return df.to_dict(orient="records")


@router.get("/risk-features/export")
async def export_risk_features(user: User = Depends(require_permission("view_risk_analytics"))):
    """Same data as CSV — for an analyst who wants to open findings in
    Excel or load them into their own pandas/plotting script outside this
    app. Same StreamingResponse pattern as /reconcile/export; bypasses
    response_model entirely like that endpoint does."""
    df = detective_service.get_all_omc_risk_features(get_engine())
    output = io.StringIO()
    df.to_csv(output, index=False)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=omc_risk_features.csv"},
    )


@router.get("/risk-features/{omc_id}", response_model=OmcRiskFeatures)
async def get_risk_features(omc_id: str, user: User = Depends(require_permission("view_risk_analytics"))):
    try:
        return detective_service.get_omc_risk(get_engine(), omc_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Unknown omc_id: {omc_id}")
