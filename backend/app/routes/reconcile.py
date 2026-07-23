from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from app.services.reconciliation import run_reconciliation, run_reconciliation_on_dataframes
from app.services.e_billing import sync_anomalies_to_ebilling, update_anomaly_status
from app.services.feed import update_feed  # <-- NEW IMPORT
from app.core.dependencies import get_current_user, require_permission
from app.models.user import User
from app.schemas.reconciliation import (
    ReconciliationResponse,
    ReconciliationUploadResponse,
    SyncAnomaliesResponse,
    UpdateAnomalyResponse,
)
import pandas as pd
import io
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


def _scope_to_permissions(result: dict, user: User) -> dict:
    """
    /reconcile bundles line-item detail (anomalies, omc_risk_profile,
    duplicate_anomalies) with aggregate metrics in one payload. Metrics/
    summary/performance/data_quality are the "Executive Metrics" row in
    the README's permission matrix — universal, every role sees them.
    The detail rows are the "Anomaly Table" row — Manager/Revenue
    Assurance only. There's no separate endpoint for the detail, so we
    filter it out of the response here rather than in the frontend.
    """
    if user.has_permission("view_anomalies"):
        return result
    return {**result, 'anomalies': [], 'omc_risk_profile': [], 'duplicate_anomalies': []}


# ============================================================================
# 1. RECONCILIATION (Database)
# ============================================================================

@router.post("/reconcile", response_model=ReconciliationResponse)
async def reconcile(
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    user: User = Depends(get_current_user),
):
    """
    Run reconciliation using the default database.
    """
    try:
        result = run_reconciliation(materiality=materiality)
        # 🚀 UPDATE THE LIVE FEED CACHE (unfiltered — the feed cache is shared,
        # not scoped to the requesting user's permissions)
        update_feed(result.get('anomalies', []))
        return {'status': 'success', 'data': _scope_to_permissions(result, user)}
    except Exception as e:
        logger.error(f"Reconciliation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 2. UPLOAD (CSV) – WITH SMART VALIDATION
# ============================================================================

@router.post("/reconcile/upload", response_model=ReconciliationUploadResponse)
async def reconcile_upload(
    dispatches_file: UploadFile = File(...),
    invoices_file: UploadFile = File(...),
    payments_file: UploadFile = File(...),
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    user: User = Depends(require_permission("upload_csv")),
):
    """
    Upload custom CSVs to test reconciliation instantly.
    """
    try:
        # --- 1. Read CSVs ---
        dispatches_df = pd.read_csv(io.StringIO((await dispatches_file.read()).decode('utf-8')))
        invoices_df = pd.read_csv(io.StringIO((await invoices_file.read()).decode('utf-8')))
        payments_df = pd.read_csv(io.StringIO((await payments_file.read()).decode('utf-8')))

        # --- 2. Validate ---
        required_disp = ['dispatch_id', 'value_kes']
        missing_disp = [c for c in required_disp if c not in dispatches_df.columns]
        if missing_disp:
            raise HTTPException(
                status_code=400,
                detail=f"Dispatches CSV missing columns: {missing_disp}. Required: 'dispatch_id', 'value_kes', and either 'customer_name' or 'customer'."
            )
        if not any(col in dispatches_df.columns for col in ['customer_name', 'customer']):
            raise HTTPException(
                status_code=400,
                detail="Dispatches CSV must contain either 'customer_name' or 'customer' column."
            )

        required_inv = ['invoice_id', 'dispatch_id', 'value_kes']
        missing_inv = [c for c in required_inv if c not in invoices_df.columns]
        if missing_inv:
            raise HTTPException(
                status_code=400,
                detail=f"Invoices CSV missing columns: {missing_inv}. Required: 'invoice_id', 'dispatch_id', 'value_kes'."
            )

        required_pay = ['invoice_id', 'value_kes']
        missing_pay = [c for c in required_pay if c not in payments_df.columns]
        if missing_pay:
            raise HTTPException(
                status_code=400,
                detail=f"Payments CSV missing columns: {missing_pay}. Required: 'invoice_id' and 'value_kes'. You may have uploaded the wrong file."
            )

        # --- 3. Run Reconciliation ---
        result = run_reconciliation_on_dataframes(dispatches_df, invoices_df, payments_df, materiality)

        # 🚀 UPDATE THE LIVE FEED CACHE (for uploads too!) — unfiltered, same
        # reasoning as the /reconcile handler above.
        update_feed(result.get('anomalies', []))

        return {
            'status': 'success',
            'data': _scope_to_permissions(result, user),
            'message': f'Processed {len(dispatches_df)} dispatches from uploaded CSVs'
        }

    except pd.errors.EmptyDataError:
        raise HTTPException(status_code=400, detail="One of the uploaded files is empty.")
    except pd.errors.ParserError as e:
        raise HTTPException(status_code=400, detail=f"CSV parsing error: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload reconciliation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 3. TEMPLATE DOWNLOAD
# ============================================================================

@router.get("/reconcile/template/{file_type}")
async def download_template(
    file_type: str,
    _user: User = Depends(require_permission("upload_csv")),
):
    """
    Download a CSV template for Dispatches, Invoices, or Payments.
    """
    if file_type not in ["dispatches", "invoices", "payments"]:
        raise HTTPException(
            status_code=400,
            detail="File type must be 'dispatches', 'invoices', or 'payments'."
        )

    if file_type == "dispatches":
        df = pd.DataFrame({
            "dispatch_id": ["DISP-0001"],
            "date": ["2025-01-15"],
            "customer_name": ["TotalEnergies Kenya"],
            "product": ["Diesel (AGO)"],
            "volume_liters": [10000],
            "value_kes": [1500000],
            "depot": ["Mombasa"]
        })
    elif file_type == "invoices":
        df = pd.DataFrame({
            "invoice_id": ["INV-0001"],
            "dispatch_id": ["DISP-0001"],
            "customer_name": ["TotalEnergies Kenya"],
            "date": ["2025-01-17"],
            "value_kes": [1500000]
        })
    else:  # payments
        df = pd.DataFrame({
            "payment_id": ["PAY-0001"],
            "invoice_id": ["INV-0001"],
            "customer_name": ["TotalEnergies Kenya"],
            "date": ["2025-02-01"],
            "value_kes": [1500000],
            "installment_number": [1],
            "total_installments": [1]
        })

    output = io.StringIO()
    df.to_csv(output, index=False)
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={file_type}_template.csv"}
    )


# ============================================================================
# 4. SYNC, UPDATE & EXPORT
# ============================================================================

@router.post("/reconcile/sync", response_model=SyncAnomaliesResponse)
async def sync_anomalies(_user: User = Depends(require_permission("manage_ebilling"))):
    try:
        result = run_reconciliation()
        anomalies = result.get('anomalies', [])
        pending = [a for a in anomalies if a.get('ebilling_status') == 'Pending']
        sync_result = sync_anomalies_to_ebilling(pending)
        return {
            'status': 'success',
            'sync_result': sync_result,
            'pending_count': len(pending)
        }
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reconcile/update", response_model=UpdateAnomalyResponse)
async def update_anomaly(
    dispatch_id: str = Query(...),
    status: str = Query(...),
    notes: str = Query(''),
    _user: User = Depends(require_permission("resolve_anomaly")),
):
    try:
        result = update_anomaly_status(dispatch_id, status, notes)
        return result
    except Exception as e:
        logger.error(f"Update failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reconcile/export")
async def export_report(
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    _user: User = Depends(require_permission("export_reports")),
):
    try:
        result = run_reconciliation(materiality=materiality)
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            pd.DataFrame([result['metrics']]).to_excel(writer, sheet_name='Summary', index=False)
            pd.DataFrame(result['anomalies']).to_excel(writer, sheet_name='Anomalies', index=False)
            pd.DataFrame([result['data_quality']]).to_excel(writer, sheet_name='Data Quality', index=False)
            if result.get('omc_risk_profile'):
                pd.DataFrame(result['omc_risk_profile']).to_excel(writer, sheet_name='OMC Risk Profile', index=False)
            if result.get('duplicate_anomalies'):
                pd.DataFrame(result['duplicate_anomalies']).to_excel(writer, sheet_name='Duplicates', index=False)
        output.seek(0)
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=reconciliation_report.xlsx"}
        )
    except Exception as e:
        logger.error(f"Export failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))