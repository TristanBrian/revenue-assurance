from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.core.dependencies import get_db, require_permission
from app.models.user import User
from app.services.reconciliation import run_reconciliation, run_reconciliation_on_dataframes
from app.services.e_billing import sync_anomalies_to_ebilling, update_anomaly_status
from app.services.feed import update_feed
from app.services.audit_service import log_action
from app.schemas.reconciliation import (
    MetricsResponse,
    AnomalyTableResponse,
    OmcRiskProfileResponse,
    ReconciliationUploadResponse,
    SyncAnomaliesResponse,
    UpdateAnomalyResponse,
)
import pandas as pd
import io
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

# ============================================================================
# 1. RECONCILIATION (Database) – split by feature permission.
# Each endpoint independently re-runs reconciliation from the DB; there's no
# shared cache between them, so a full page load that hits all three costs
# the compute 3x. Acceptable trade-off for keeping each feature's visibility
# independently gated without a caching layer.
#
# All three below are plain def, not async def: run_reconciliation() is a
# synchronous, CPU-bound pandas pipeline over the full dataset (multi-second
# even on this synthetic ~49k-row set). As async def, that blocks the whole
# event loop for every concurrent request — across every user — for the
# entire run; two of these firing together (e.g. the executive dashboard's
# Promise.all of metrics + omc-risk-profile) serialize back-to-back on one
# blocked loop and everything else queues behind them, which is exactly
# what /reconcile/sync's own comment below already flags for the e-billing
# path. FastAPI runs plain def routes in a threadpool automatically, which
# keeps the event loop free for other requests while these run.
# ============================================================================

@router.post("/reconcile/metrics", response_model=MetricsResponse)
def reconcile_metrics(
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    _: User = Depends(require_permission("view_metrics")),
):
    """Executive Metrics feature: KPI/summary data only, no raw anomaly rows."""
    try:
        result = run_reconciliation(materiality=materiality)
        update_feed(result.get('anomalies', []))
        return {
            'status': 'success',
            'metrics': result['metrics'],
            'summary': result['summary'],
            'performance': result['performance'],
            'data_quality': result['data_quality'],
            'ebilling_status': result.get('ebilling_status'),
            'duplicate_anomalies': result.get('duplicate_anomalies', []),
        }
    except Exception as e:
        logger.error(f"Reconciliation metrics failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reconcile/anomalies", response_model=AnomalyTableResponse)
def reconcile_anomalies(
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    page: int = Query(1, description="Page number", ge=1),
    page_size: int = Query(20, description="Items per page", ge=1, le=100),
    _: User = Depends(require_permission("view_anomaly_table")),
):
    """Anomaly Table feature: paginated raw anomaly rows."""
    try:
        result = run_reconciliation(materiality=materiality)
        all_anomalies = result.get('anomalies', [])
        total_anomalies = len(all_anomalies)
        total_pages = (total_anomalies + page_size - 1) // page_size if total_anomalies > 0 else 1
        offset = (page - 1) * page_size
        paginated_anomalies = all_anomalies[offset:offset + page_size]
        return {
            'status': 'success',
            'anomalies': paginated_anomalies,
            'pagination': {
                'page': page,
                'page_size': page_size,
                'total': total_anomalies,
                'total_pages': total_pages,
                'has_next': page * page_size < total_anomalies,
                'has_prev': page > 1
            }
        }
    except Exception as e:
        logger.error(f"Reconciliation anomalies failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reconcile/omc-risk-profile", response_model=OmcRiskProfileResponse)
def reconcile_omc_risk_profile(
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    _: User = Depends(require_permission("view_omc_risk_profile")),
):
    """OMC Risk Profile feature."""
    try:
        result = run_reconciliation(materiality=materiality)
        return {
            'status': 'success',
            'omc_risk_profile': result.get('omc_risk_profile', [])
        }
    except Exception as e:
        logger.error(f"Reconciliation OMC risk profile failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 2. UPLOAD (CSV) – WITH PAGINATION
# ============================================================================

@router.post("/reconcile/upload", response_model=ReconciliationUploadResponse)
def reconcile_upload(
    dispatches_file: UploadFile = File(...),
    invoices_file: UploadFile = File(...),
    payments_file: UploadFile = File(...),
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    page: int = Query(1, description="Page number", ge=1),
    page_size: int = Query(20, description="Items per page", ge=1, le=100),
    user: User = Depends(require_permission("upload_csv")),
):
    """
    Upload custom CSVs with paginated anomalies. The anomaly table and OMC
    risk profile within the response are additionally stripped to empty
    lists if the caller lacks view_anomaly_table / view_omc_risk_profile
    respectively — upload_csv alone doesn't imply visibility into those
    (e.g. Depot Supervisor can upload but shouldn't see the anomaly table).

    Plain def, not async def, same reasoning as the block comment above —
    run_reconciliation_on_dataframes() is the same synchronous pandas
    pipeline. file.file.read() (the underlying SpooledTemporaryFile) is
    used instead of the async UploadFile.read() since this handler no
    longer has an event loop to await on.
    """
    try:
        # --- 1. Read CSVs ---
        dispatches_df = pd.read_csv(io.StringIO(dispatches_file.file.read().decode('utf-8')))
        invoices_df = pd.read_csv(io.StringIO(invoices_file.file.read().decode('utf-8')))
        payments_df = pd.read_csv(io.StringIO(payments_file.file.read().decode('utf-8')))

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
        
        # Update live feed cache with ALL anomalies
        update_feed(result.get('anomalies', []))
        
        # Paginate anomalies
        all_anomalies = result.get('anomalies', [])
        total_anomalies = len(all_anomalies)
        total_pages = (total_anomalies + page_size - 1) // page_size if total_anomalies > 0 else 1
        offset = (page - 1) * page_size
        paginated_anomalies = all_anomalies[offset:offset + page_size] if user.has_permission("view_anomaly_table") else []

        # Reconstruct result with paginated anomalies
        paginated_result = {
            'metrics': result['metrics'],
            'anomalies': paginated_anomalies,
            'summary': result['summary'],
            'performance': result['performance'],
            'data_quality': result['data_quality'],
            'ebilling_status': result.get('ebilling_status'),
            'duplicate_anomalies': result.get('duplicate_anomalies', []),
            'omc_risk_profile': result.get('omc_risk_profile', []) if user.has_permission("view_omc_risk_profile") else []
        }

        return {
            'status': 'success',
            'data': paginated_result,
            'pagination': {
                'page': page,
                'page_size': page_size,
                'total': total_anomalies,
                'total_pages': total_pages,
                'has_next': page * page_size < total_anomalies,
                'has_prev': page > 1
            },
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
    _: User = Depends(require_permission("upload_csv")),
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
def sync_anomalies(
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("manage_ebilling")),
):
    # Plain def, not async def: sync_anomalies_to_ebilling() calls
    # call_kra_api(), which sleeps synchronously (time.sleep, not
    # asyncio.sleep) per invoice plus retry backoff. As async def, that
    # blocks the entire event loop for every concurrent request across
    # every user until this one finishes. FastAPI runs plain def routes
    # in a threadpool automatically, which keeps the event loop free.
    try:
        result = run_reconciliation()
        anomalies = result.get('anomalies', [])
        pending = [a for a in anomalies if a.get('ebilling_status') == 'Pending']
        sync_result = sync_anomalies_to_ebilling(pending)
        # sync_anomalies_to_ebilling() writes through its own raw-engine
        # transaction (already committed by the time we get here), not
        # this request's ORM session — so this commit is only for the
        # audit row itself, not joint atomicity with the sync it describes.
        log_action(
            db,
            actor_user_id=user.id,
            action="ebilling.sync",
            target_type="sync_task",
            after={"pending_count": len(pending), "sync_result": sync_result},
        )
        db.commit()
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
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("resolve_anomaly")),
):
    try:
        result = update_anomaly_status(db, dispatch_id, status, notes, actor_user_id=user.id)
        return result
    except Exception as e:
        logger.error(f"Update failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reconcile/export")
def export_report(
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    _: User = Depends(require_permission("export_reports")),
):
    # Plain def, not async def — same reasoning as the block comment above
    # (run_reconciliation()) plus the ExcelWriter/openpyxl write itself,
    # both synchronous and CPU-bound.
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