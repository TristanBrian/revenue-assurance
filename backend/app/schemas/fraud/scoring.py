"""
Pydantic schemas for routes/fraud/scoring.py — the fraud scoring layer's
explainability endpoints. Mirrors the shapes services/fraud/
fraud_scoring_service.explain_anomaly() actually returns (verified via
direct inspection of that function, same convention as schemas/
reconciliation/reconciliation.py's own header note).
"""
from typing import Optional

from pydantic import BaseModel


class ShapContributor(BaseModel):
    feature: str
    value: float
    contribution: float
    direction: str  # "toward_fraud" | "toward_benign"


class FraudExplainData(BaseModel):
    anomaly_id: str
    fraud_score: Optional[float] = None
    fraud_tier: Optional[str] = None
    base_value: float
    contributors: list[ShapContributor]


class FraudExplainResponse(BaseModel):
    """GET /api/fraud/explain/{anomaly_id}"""
    status: str
    data: FraudExplainData


class FraudChatRequest(BaseModel):
    """POST /api/fraud/chat"""
    message: str
    anomaly_id: Optional[str] = None  # required for "why is this flagged"-style questions, ignored otherwise


class FraudChatResponse(BaseModel):
    """POST /api/fraud/chat"""
    status: str
    reply: str
