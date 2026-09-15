"""
Chatbot API routes. All endpoints are JWT + RBAC protected.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.core.dependencies import require_permission
from app.models.auth.user import User

router = APIRouter()

class ChatbotRequest(BaseModel):
    question: str
    k: Optional[int] = 5

class IngestRequest(BaseModel):
    url: str

@router.post("/chatbot")
async def chatbot_query(
    request: ChatbotRequest,
    user: User = Depends(require_permission("view_metrics"))
):
    try:
        from app.services.rag.rag_service import ask_question
        result = ask_question(request.question, request.k)
        return {
            "Success": 1,
            "Message": "Success",
            "Data": result,
            "Timestamp": "2026-08-22T00:00:00Z"  # you can use datetime.utcnow()
        }
    except Exception:
        # The local knowledge base/LLM is optional in the demo and may not be
        # available in a production API replica. Keep support useful with a
        # safe, deterministic response rather than breaking the widget.
        result = {
            "question": request.question,
            "answer": "I can help with FlowGuard navigation, reconciliation, anomaly review, reports, and access. For a case-specific decision, open the relevant case and use its evidence panel.",
            "context": [],
        }

@router.post("/chatbot/ingest-url")
async def ingest_document_url(
    request: IngestRequest,
    user: User = Depends(require_permission("manage_alerts"))
):
    from app.services.rag.rag_service import ingest_url
    result = ingest_url(request.url)
    return {
        "Success": 1 if result["success"] else 0,
        "Message": result["message"],
        "Data": result,
        "Timestamp": "2026-08-22T00:00:00Z"
    }

@router.post("/chatbot/reload")
async def reload_kb(
    user: User = Depends(require_permission("manage_alerts"))
):
    from app.services.rag.rag_service import reload_knowledge_base
    result = reload_knowledge_base()
    return {
        "Success": 1,
        "Message": result["message"],
        "Data": result,
        "Timestamp": "2026-08-22T00:00:00Z"
    }