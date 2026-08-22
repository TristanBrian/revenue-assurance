"""
Chatbot API routes. All endpoints are JWT + RBAC protected.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services.rag.rag_service import answer_question, ingest_url, reload_knowledge_base
from app.core.dependencies import require_permission
from app.models.user import User  # adjust import if needed

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
        result = answer_question(request.question, request.k)
        return {
            "Success": 1,
            "Message": "Success",
            "Data": result,
            "Timestamp": "2026-08-22T00:00:00Z"  # you can use datetime.utcnow()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chatbot/ingest-url")
async def ingest_document_url(
    request: IngestRequest,
    user: User = Depends(require_permission("manage_alerts"))
):
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
    result = reload_knowledge_base()
    return {
        "Success": 1,
        "Message": result["message"],
        "Data": result,
        "Timestamp": "2026-08-22T00:00:00Z"
    }