"""
Autonomous Control Plane Actions API Router (Section 4)
Handles automated gate lockout checks, KRA iCMS tax adjustment notes, and automated demurrage invoicing.
"""

from typing import Optional
from app.core.dependencies import require_workspace_permission
from fastapi import Depends, APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/control", tags=["Autonomous Control Plane Actions"])


class LockoutCheckRequest(BaseModel):
    dispatch_id: str = Field(..., description="Unique dispatch or manifest ID")
    truck_id: str = Field(..., description="Truck registration plate")
    omc_name: str = Field(..., description="Oil Marketing Company name")
    metered_volume_l: float = Field(..., ge=0, allow_inf_nan=False, description="Physical loading arm metered volume in Litres")
    invoiced_volume_l: float = Field(..., gt=0, allow_inf_nan=False, description="Invoiced volume in Litres")
    allowed_evaporation_pct: float = Field(..., ge=0, le=5, allow_inf_nan=False, description="Evaporation tolerance threshold (%)")


class LockoutCheckResponse(BaseModel):
    status: str = Field(..., description="PASS or GATE_HOLD")
    dispatch_id: str
    truck_id: str
    metered_volume_l: float
    invoiced_volume_l: float
    variance_l: float
    evaporation_tolerance_l: float
    lockout_triggered: bool
    reason: str
    action_required: str
    simulation: bool = True
    authoritative_gate_decision: bool = False


class IcmsAdjustmentNoteRequest(BaseModel):
    dispatch_id: str
    anomaly_id: str
    kra_pin: str = Field(default="P051123456Z", description="Taxpayer KRA PIN")
    original_invoice_ref: str
    adjusted_volume_l: float
    unit_price_kes: float = Field(default=145.50, description="Per Litre base price in KES")
    note_type: str = Field(default="DEBIT_NOTE", description="DEBIT_NOTE or CREDIT_NOTE")
    resolution_notes: str


class IcmsAdjustmentNoteResponse(BaseModel):
    success: bool
    adjustment_note_id: str
    kra_ack_number: str
    note_type: str
    tax_adjustment_kes: float
    status: str
    timestamp: str


class DemurrageInvoiceRequest(BaseModel):
    truck_id: str
    omc_name: str
    depot_id: str = Field(default="NBO-01", description="Depot identifier")
    gantry_lane: int = Field(..., ge=1, le=12)
    entry_time: str
    exit_time: str
    dwell_time_minutes: int
    free_time_sla_minutes: int = Field(default=45, description="Free-time SLA threshold in minutes")
    demurrage_rate_per_hour_kes: float = Field(default=2500.0, description="Hourly demurrage charge")


class DemurrageInvoiceResponse(BaseModel):
    invoice_id: str
    sap_doc_number: str
    truck_id: str
    omc_name: str
    billable_demurrage_minutes: int
    total_demurrage_kes: float
    status: str
    issued_at: str


@router.post("/lockout-check", response_model=LockoutCheckResponse)
def check_gate_lockout(req: LockoutCheckRequest, user=Depends(require_workspace_permission("view_metrics", "inbound"))):
    """
    Automated Gate Lockout API.
    Blocks dispatch clearance if metered_volume > invoiced_volume + allowed_evaporation.
    """
    evap_allowance = req.invoiced_volume_l * (req.allowed_evaporation_pct / 100.0)
    max_permitted = req.invoiced_volume_l + evap_allowance
    variance = req.metered_volume_l - req.invoiced_volume_l

    if req.metered_volume_l > max_permitted:
        lockout = True
        gate_status = "GATE_HOLD"
        excess = req.metered_volume_l - max_permitted
        reason = f"Metered volume ({req.metered_volume_l:,.0f} L) exceeds invoiced volume ({req.invoiced_volume_l:,.0f} L) by {variance:,.0f} L (excess beyond {req.allowed_evaporation_pct}% evaporation tolerance: {excess:,.0f} L)."
        action = "Preview only: proposed hold. No physical gate command was sent."
    else:
        lockout = False
        gate_status = "PASS"
        reason = f"Metered volume ({req.metered_volume_l:,.0f} L) within invoiced threshold ({req.invoiced_volume_l:,.0f} L)."
        action = "Preview only: volume is within the supplied tolerance. This is not exit authorization."

    return LockoutCheckResponse(
        status=gate_status,
        dispatch_id=req.dispatch_id,
        truck_id=req.truck_id,
        metered_volume_l=req.metered_volume_l,
        invoiced_volume_l=req.invoiced_volume_l,
        variance_l=variance,
        evaporation_tolerance_l=evap_allowance,
        lockout_triggered=lockout,
        reason=reason,
        action_required=action,
    )


@router.post("/icms-adjustment-note", response_model=IcmsAdjustmentNoteResponse)
def issue_icms_adjustment_note(req: IcmsAdjustmentNoteRequest, user=Depends(require_workspace_permission("manage_ebilling", "inbound"))):
    """
    Automated KRA iCMS Tax Adjustment Note.
    Triggers an automated API request to KRA iCMS to issue a Credit/Debit Note when volume discrepancies are resolved.
    """
    raise HTTPException(status_code=501, detail="KRA adjustment submission is not configured. No tax note has been issued.")


@router.post("/demurrage-invoice", response_model=DemurrageInvoiceResponse)
def generate_demurrage_invoice(req: DemurrageInvoiceRequest, user=Depends(require_workspace_permission("manage_ebilling", "inbound"))):
    """
    Automated Demurrage Invoice Generator.
    Triggers an API call drafting/issuing a SAP/KPC invoice for demurrage the moment a truck exits past free-time SLA.
    """
    raise HTTPException(status_code=501, detail="SAP demurrage issuance requires persisted yard events and an approved contract adapter. No invoice has been issued.")
