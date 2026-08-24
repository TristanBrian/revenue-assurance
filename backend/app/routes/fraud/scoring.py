"""
routes/fraud/scoring.py — the fraud scoring layer's explainability
endpoints (Section 6 of the fraud-scoring spec). Bare paths here;
prefix="/api/fraud" and tags=["Fraud Scoring"] are supplied by main.py's
include_router(), same convention as every other route file.

Anomalies aren't persisted rows (see services/reconciliation/
reconciliation.py's module notes — they're computed dicts, rebuilt fresh
every reconciliation run), so "look up anomaly {id}" means re-running
reconciliation and finding the matching dispatch_id-shaped key in the
result, not a DB SELECT by primary key. Gated on view_anomaly_table (not
a new permission) — explaining a score is a deeper view into the same
anomaly table data that permission already grants, not a separate
feature.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.dependencies import require_permission, enforce_reconciliation_scope
from app.models.auth.user import User
from app.schemas.fraud.scoring import FraudChatRequest, FraudChatResponse, FraudExplainResponse
from app.services.fraud import feature_builder, fraud_scoring_service
from app.services.reconciliation.reconciliation import run_combined_reconciliation
from app.utils.db_connection import get_engine
import pandas as pd

logger = logging.getLogger(__name__)

router = APIRouter()


def _find_anomaly_and_context(anomaly_id: str, direction: str) -> tuple[Optional[dict], Optional[dict]]:
    """Re-runs reconciliation across both directions at materiality=0
    (so a small, non-materiality-crossing anomaly can still be explained
    — the fraud score doesn't depend on materiality), finds the anomaly
    with a matching natural key, and gathers the same duplicate_ids/
    value_delta_zscore_by_actor context score_anomalies() used when it
    was originally scored — needed here because explain_anomaly()
    rebuilds the feature row from scratch to run SHAP on it, and those
    two context values aren't things the anomaly dict itself carries.
    Returns (anomaly, context) — (None, None) if no anomaly has that id.
    """
    result = run_combined_reconciliation(direction=direction, materiality=0)
    anomaly = next((a for a in result.get("anomalies", []) if a.get("dispatch_id") == anomaly_id), None)
    if anomaly is None:
        return None, None

    engine = get_engine()
    direction = anomaly.get("flow_direction", "inbound")
    if direction == "outbound":
        attendance_df = pd.read_sql("SELECT * FROM attendance", engine)
        authorizations_df = pd.read_sql("SELECT * FROM stipend_authorizations", engine)
        disbursements_df = pd.read_sql("SELECT * FROM disbursements", engine)
        context = feature_builder.gather_outbound_context(attendance_df, authorizations_df, disbursements_df)
    else:
        dispatches_df = pd.read_sql("SELECT * FROM dispatches", engine)
        invoices_df = pd.read_sql("SELECT * FROM invoices", engine)
        context = feature_builder.gather_inbound_context(dispatches_df, invoices_df, engine)

    return anomaly, context


@router.get("/explain/{anomaly_id}", response_model=FraudExplainResponse)
def explain_anomaly_score(
    anomaly_id: str,
    direction: str = Query("all", description="inbound | outbound | all"),
    user: User = Depends(require_permission("view_anomaly_table")),
):
    enforce_reconciliation_scope(user, direction)
    if not fraud_scoring_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="Fraud scoring model isn't trained yet — run scripts/train_fraud_model.py first.",
        )

    anomaly, context = _find_anomaly_and_context(anomaly_id, direction)
    if anomaly is None:
        raise HTTPException(status_code=404, detail=f"No anomaly found with id: {anomaly_id}")

    explanation = fraud_scoring_service.explain_anomaly(
        anomaly,
        direction=anomaly.get("flow_direction", "inbound"),
        duplicate_ids=context["duplicate_ids"],
        value_delta_zscore_by_actor=context["value_delta_zscore_by_actor"],
    )
    if explanation is None:
        raise HTTPException(status_code=503, detail="Could not compute an explanation for this anomaly.")

    return {"status": "success", "data": explanation}


@router.post("/chat", response_model=FraudChatResponse)
def fraud_chat(
    payload: FraudChatRequest,
    direction: str = Query("all", description="inbound | outbound | all"),
    user: User = Depends(require_permission("view_anomaly_table")),
):
    enforce_reconciliation_scope(user, direction)
    """Chat-style explain endpoint (Section 6) — a lightweight canned-
    response function, not an LLM call, grounded in real stored SHAP/
    metrics data. See fraud_scoring_service.chat_explain() for the
    recognized question shapes."""
    anomaly, context = (None, None)
    if payload.anomaly_id:
        anomaly, context = _find_anomaly_and_context(payload.anomaly_id, direction)

    reply = fraud_scoring_service.chat_explain(
        payload.message,
        anomaly=anomaly,
        direction=anomaly.get("flow_direction") if anomaly else None,
        duplicate_ids=context["duplicate_ids"] if context else None,
        value_delta_zscore_by_actor=context["value_delta_zscore_by_actor"] if context else None,
    )
    return {"status": "success", "reply": reply}
