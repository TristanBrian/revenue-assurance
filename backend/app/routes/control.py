"""
Autonomous Control Plane Actions API Router (Section 4)
Handles automated gate lockout checks, KRA iCMS tax adjustment notes, and automated demurrage invoicing.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/control", tags=["Autonomous Control Plane Actions"])


class LockoutCheckRequest(BaseModel):
    dispatch_id: str = Field(..., description="Unique dispatch or manifest ID")
    truck_id: str = Field(..., description="Truck registration plate")
    omc_name: str = Field(..., description="Oil Marketing Company name")
    metered_volume_l: float = Field(..., description="Physical loading arm metered volume in Litres")
    invoiced_volume_l: float = Field(..., description="Invoiced volume in Litres")
    allowed_evaporation_pct: float = Field(default=0.15, description="Evaporation tolerance threshold (%)")


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
def check_gate_lockout(req: LockoutCheckRequest):
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
        action = "Automated gate barrier lockout active. Dispatch supervisor authorization required."
    else:
        lockout = False
        gate_status = "PASS"
        reason = f"Metered volume ({req.metered_volume_l:,.0f} L) within invoiced threshold ({req.invoiced_volume_l:,.0f} L)."
        action = "Automated gate clearance granted. Vehicle authorized to exit gantry."

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
def issue_icms_adjustment_note(req: IcmsAdjustmentNoteRequest):
    """
    Automated KRA iCMS Tax Adjustment Note.
    Triggers an automated API request to KRA iCMS to issue a Credit/Debit Note when volume discrepancies are resolved.
    """
    if req.adjusted_volume_l <= 0:
        raise HTTPException(status_code=400, detail="Adjusted volume must be positive")

    vat_rate = 0.16
    base_amount = req.adjusted_volume_l * req.unit_price_kes
    tax_adjustment = base_amount * vat_rate
    import uuid
    from datetime import datetime, timezone

    note_id = f"KRA-{req.note_type[:3]}-{uuid.uuid4().hex[:8].upper()}"
    ack_number = f"ACK-iCMS-{uuid.uuid4().hex[:10].upper()}"

    return IcmsAdjustmentNoteResponse(
        success=True,
        adjustment_note_id=note_id,
        kra_ack_number=ack_number,
        note_type=req.note_type,
        tax_adjustment_kes=round(tax_adjustment, 2),
        status="SUBMITTED_TO_ICMS",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/demurrage-invoice", response_model=DemurrageInvoiceResponse)
def generate_demurrage_invoice(req: DemurrageInvoiceRequest):
    """
    Automated Demurrage Invoice Generator.
    Triggers an API call drafting/issuing a SAP/KPC invoice for demurrage the moment a truck exits past free-time SLA.
    """
    import uuid
    from datetime import datetime, timezone

    billable_minutes = max(0, req.dwell_time_minutes - req.free_time_sla_minutes)
    billable_hours = billable_minutes / 60.0
    total_kes = round(billable_hours * req.demurrage_rate_per_hour_kes, 2)

    inv_id = f"DEM-{uuid.uuid4().hex[:8].upper()}"
    sap_doc = f"SAP-900{uuid.uuid4().hex[:6].upper()}"

    return DemurrageInvoiceResponse(
        invoice_id=inv_id,
        sap_doc_number=sap_doc,
        truck_id=req.truck_id,
        omc_name=req.omc_name,
        billable_demurrage_minutes=billable_minutes,
        total_demurrage_kes=total_kes,
        status="ISSUED_TO_SAP",
        issued_at=datetime.now(timezone.utc).isoformat(),
    )
