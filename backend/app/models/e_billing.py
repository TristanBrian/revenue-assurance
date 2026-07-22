from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class EBillingSyncStatus(BaseModel):
    invoice_id: str
    status: str  # pending, synced, failed
    sync_date: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int = 0
    last_attempt: Optional[str] = None

class EBillingSyncRequest(BaseModel):
    invoice_ids: Optional[list[str]] = None  # None means sync all pending

class EBillingSyncResponse(BaseModel):
    total_processed: int
    synced: int
    failed: int
    failed_ids: list[str]
    sync_time: str