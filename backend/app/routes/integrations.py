"""
KPC Enterprise System Integration Architecture Router (Section 5)
Provides SAP ERP (SD/MM) OData/REST interface stubs for Invoices, Delivery Orders, Credit Notes
and SCADA Telemetry Webhook ingestion for real-time loading meter pulses across gantries.
"""

from typing import List, Optional
from datetime import datetime, timezone
from app.core.dependencies import require_workspace_permission
from fastapi import Depends, APIRouter, HTTPException, Header, status
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/integrations", tags=["KPC Enterprise Integration Architecture"])


# --- SAP ERP Adapter Schemas & Endpoints ---
class SapIdocItem(BaseModel):
    item_no: int
    material_code: str = Field(..., description="SAP Material Code, e.g., AGO-01, PMS-01")
    description: str
    volume_litres: float
    unit_price_kes: float


class SapInvoicePayload(BaseModel):
    sap_idoc_num: str = Field(..., description="IDoc control number")
    document_type: str = Field(default="INVOICE", description="INVOICE, DELIVERY_ORDER, or CREDIT_NOTE")
    omc_code: str = Field(..., description="SAP Customer/OMC ID")
    omc_name: str
    posting_date: str
    items: List[SapIdocItem]


class SapIdocResponse(BaseModel):
    status: str
    idoc_num: str
    sap_billing_document: str
    total_value_kes: float
    acknowledged_at: str


class ScadaMeterPulsePayload(BaseModel):
    depot_id: str = Field(..., description="Depot location: Mombasa, Nakuru, Eldoret, Kisumu")
    gantry_lane: int = Field(..., ge=1, le=12)
    meter_id: str = Field(..., description="Flow meter serial number")
    truck_id: str
    flow_rate_lpm: float = Field(..., description="Flow rate in Litres per minute")
    accumulated_volume_l: float = Field(..., description="Accumulated batch volume in Litres")
    pulse_count: int
    sensor_status: str = Field(default="NORMAL", description="NORMAL, WARNING, FAULT")


class ScadaMeterPulseResponse(BaseModel):
    status: str
    telemetry_id: str
    depot_id: str
    gantry_lane: int
    metered_volume_l: float
    recorded_at: str


@router.post("/sap/idoc", response_model=SapIdocResponse)
def receive_sap_idoc(payload: SapInvoicePayload, x_sap_client: Optional[str] = Header("100"), user=Depends(require_workspace_permission("manage_ebilling", "inbound"))):
    """
    SAP ERP Integration Adapter (SAP SD / MM).
    REST/OData interface stub mimicking SAP IDocs for automated sync of Invoices, Delivery Orders, and Credit Notes.
    """
    raise HTTPException(status_code=501, detail="SAP IDoc persistence and processing are not configured. No document has been processed.")


@router.post("/scada/meter-pulse", response_model=ScadaMeterPulseResponse)
def ingest_scada_meter_pulse(payload: ScadaMeterPulsePayload, user=Depends(require_workspace_permission("upload_csv", "inbound"))):
    """
    SCADA & Loading Meter Telemetry Adapter.
    Supports MQTT / REST webhook ingestion of real-time flow meter pulses directly from depot gantries (Mombasa, Nakuru, Eldoret, Kisumu).
    """
    raise HTTPException(status_code=501, detail="SCADA persistence is not configured. No telemetry has been recorded.")
