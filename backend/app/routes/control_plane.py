from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import logging
from typing import Optional

router = APIRouter(prefix="/control-plane", tags=["Autonomous Control Plane"])
logger = logging.getLogger(__name__)

class GateCheckRequest(BaseModel):
    dispatch_id: str
    metered_volume: int
    invoiced_volume: int
    product: str
    dwell_time_hours: float

class GateCheckResponse(BaseModel):
    status: str
    action: str
    reason: Optional[str] = None
    demurrage_kes: int = 0

def get_tolerance(product_str: str, volume: int) -> float:
    p = product_str.upper()
    if 'PMS' in p: return volume * 0.005
    if 'AGO' in p: return volume * 0.003
    if 'IK' in p: return volume * 0.002
    return 0

@router.post("/gate-lockout", response_model=GateCheckResponse)
def check_gate_status(request: GateCheckRequest):
    """
    Automated Gate Lockout API.
    Checks if volume discrepancy or demurrage requires a gate hold.
    """
    # 1. Volume Check
    variance = request.metered_volume - request.invoiced_volume
    allowed = get_tolerance(request.product, request.invoiced_volume)
    
    if variance > allowed:
        return GateCheckResponse(
            status="HOLD", 
            action="BLOCK_EXIT", 
            reason=f"Volume discrepancy: Variance {variance} exceeds allowed {allowed} for {request.product}"
        )
        
    # 2. Demurrage Check
    demurrage = 0
    if request.dwell_time_hours > 2:
        demurrage = int((request.dwell_time_hours - 2) * 5000)
        return GateCheckResponse(
            status="HOLD",
            action="ISSUE_DEMURRAGE",
            reason=f"Demurrage applies: {demurrage} KES",
            demurrage_kes=demurrage
        )
        
    return GateCheckResponse(status="PASS", action="ALLOW_EXIT")

class TaxNoteRequest(BaseModel):
    dispatch_id: str
    volume_discrepancy: int

@router.post("/icms-tax-adjustment")
def issue_tax_adjustment(request: TaxNoteRequest):
    """
    Mock API to trigger automated KRA iCMS Tax Adjustment Note.
    """
    logger.info(f"Triggering iCMS tax adjustment for dispatch {request.dispatch_id}. Discrepancy: {request.volume_discrepancy}")
    # In a real system, this would call the KRA API with a Dead-Letter Queue for failures
    return {
        "status": "success",
        "icms_reference": f"KRA-ADJ-{request.dispatch_id}",
        "message": "Tax adjustment note queued for processing."
    }

class NotificationRequest(BaseModel):
    incident_type: str
    dispatch_id: str
    details: str

@router.post("/notify")
def send_realtime_notification(request: NotificationRequest):
    """
    Mock API for Slack/PagerDuty notification.
    """
    logger.warning(f"CRITICAL ALERT ({request.incident_type}): Dispatch {request.dispatch_id} - {request.details}")
    return {"status": "dispatched"}
