# backend/app/routes/reconcile.py
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.dependencies import get_db, require_permission
from app.models.user import User
from app.services.reconciliation import run_reconciliation, run_reconciliation_on_dataframes
from app.services.e_billing import sync_anomalies_to_ebilling, update_anomaly_status
from app.services.feed import update_feed
from app.services.audit_service import log_action
from app.core.cache import get_cached_result, set_cached_result, invalidate_cache
from app.schemas.reconciliation import (
    MetricsResponse,
    AnomalyTableResponse,
    OmcRiskProfileResponse,
    ReconciliationUploadResponse,
    SyncAnomaliesResponse,
    UpdateAnomalyResponse,
)
import pandas as pd
import numpy as np
import io
import logging
import math
from app.utils.db_connection import get_engine
from typing import Optional

logger = logging.getLogger(__name__)

router = APIRouter()

# ============================================================================
# ULTIMATE SANITIZER – handles arrays, scalars, Timestamps, whole floats
# ============================================================================

def deep_sanitize(obj):
    """
    Recursively convert:
      - numpy array / pandas Series with shape > 0 → list
      - numpy scalars → Python primitive (via .item())
      - pandas Timestamp → ISO‑format string
      - pandas NaT / NaN → None
      - float that is a whole number → int
      - any other unsupported type → returned as is
    """
    # 1. Handle array‑like objects with at least one dimension (shape non‑empty)
    if hasattr(obj, 'shape') and len(obj.shape) > 0:
        if hasattr(obj, 'tolist'):
            obj = obj.tolist()
        else:
            obj = list(obj)
        return [deep_sanitize(item) for item in obj]

    # 2. Handle numpy scalars
    if isinstance(obj, np.generic):
        obj = obj.item() if hasattr(obj, 'item') else obj

    # 3. Check for NaN
    try:
        if pd.isna(obj):
            return None
    except (ValueError, TypeError):
        pass

    # 4. Convert timestamps
    if isinstance(obj, (pd.Timestamp, pd.DatetimeIndex)):
        return obj.isoformat()

    # 5. Convert floats
    if isinstance(obj, float):
        if math.isnan(obj):
            return None
        if obj.is_integer():
            return int(obj)
        return obj

    # 6. Recurse
    if isinstance(obj, dict):
        return {k: deep_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [deep_sanitize(item) for item in obj]

    return obj

# ============================================================================
# 1. RECONCILIATION (Database) – WITH CACHING
# ============================================================================

@router.post("/reconcile/metrics", response_model=MetricsResponse)
def reconcile_metrics(
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    _: User = Depends(require_permission("view_metrics")),
):
    try:
        cache_key = f"metrics_{materiality}"
        cached = get_cached_result(cache_key)
        if cached:
            logger.info(f"✅ Metrics cache hit for materiality={materiality}")
            return {
                'status': 'success',
                'metrics': cached['metrics'],
                'summary': cached['summary'],
                'performance': cached['performance'],
                'data_quality': cached['data_quality'],
                'ebilling_status': cached.get('ebilling_status'),
                'duplicate_anomalies': cached.get('duplicate_anomalies', []),
            }

        logger.info(f"🔄 Metrics cache miss for materiality={materiality}, running reconciliation...")
        result = run_reconciliation(materiality=materiality)
        update_feed(result.get('anomalies', []))

        metrics_data = {
            'metrics': result['metrics'],
            'summary': result['summary'],
            'performance': result['performance'],
            'data_quality': result['data_quality'],
            'ebilling_status': result.get('ebilling_status'),
            'duplicate_anomalies': result.get('duplicate_anomalies', []),
            'omc_risk_profile': result.get('omc_risk_profile', []),
            'anomalies': result.get('anomalies', []),
        }

        metrics_data = deep_sanitize(metrics_data)
        set_cached_result(cache_key, metrics_data)
        logger.info(f"✅ Metrics cached for materiality={materiality}")

        return {
            'status': 'success',
            **metrics_data
        }
    except Exception as e:
        logger.error(f"Reconciliation metrics failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reconcile/anomalies", response_model=AnomalyTableResponse)
def reconcile_anomalies(
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    page: int = Query(1, description="Page number", ge=1),
    page_size: int = Query(20, description="Items per page", ge=1, le=100),
    break_type: Optional[str] = Query(None, description="Filter by break type (e.g. Overpayment, Underpayment, Missing Invoice, Missing Payment)"),
    status: Optional[str] = Query(None, description="Filter by status (e.g. Critical, Pending, Review Required, Reconciled)"),
    search: Optional[str] = Query(None, description="Search across OMC, dispatch ID, product, invoice ID"),
    _: User = Depends(require_permission("view_anomaly_table")),
):
    """
    Anomaly Table feature: paginated raw anomaly rows with filtering.
    Uses cached reconciliation data to avoid re-running full reconciliation.
    """
    try:
        cache_key = f"metrics_{materiality}"
        cached = get_cached_result(cache_key)
        if cached:
            logger.info(f"✅ Anomalies cache hit for materiality={materiality}")
            all_anomalies = cached.get('anomalies', [])
        else:
            logger.info(f"🔄 Anomalies cache miss – running reconciliation...")
            result = run_reconciliation(materiality=materiality)
            update_feed(result.get('anomalies', []))
            metrics_data = {
                'metrics': result['metrics'],
                'summary': result['summary'],
                'performance': result['performance'],
                'data_quality': result['data_quality'],
                'ebilling_status': result.get('ebilling_status'),
                'duplicate_anomalies': result.get('duplicate_anomalies', []),
                'omc_risk_profile': result.get('omc_risk_profile', []),
                'anomalies': result.get('anomalies', []),
            }
            metrics_data = deep_sanitize(metrics_data)
            set_cached_result(cache_key, metrics_data)
            all_anomalies = result.get('anomalies', [])

        # --- Apply filters (if provided) ---
        if break_type:
            all_anomalies = [a for a in all_anomalies if a.get('break_type') == break_type]
        if status:
            # "Resolved" is never a value of the primary `status` field —
            # that one only ever holds Critical/Pending/Review Required/
            # Reconciled, straight from run_reconciliation(). Resolution is
            # a separate overlay (`resolution_status`, set by
            # POST /reconcile/update and persisted in anomaly_resolutions),
            # so status=Resolved has to check that field instead or it
            # would silently match zero rows forever.
            if status == "Resolved":
                all_anomalies = [a for a in all_anomalies if a.get('resolution_status') == 'Resolved']
            else:
                all_anomalies = [a for a in all_anomalies if a.get('status') == status]
        if search:
            search_lower = search.lower()
            all_anomalies = [
                a for a in all_anomalies
                if search_lower in str(a.get('dispatch_id', '')).lower()
                or search_lower in str(a.get('customer', '')).lower()
                or search_lower in str(a.get('product', '')).lower()
                or search_lower in str(a.get('invoice_id', '')).lower()
            ]

        total_anomalies = int(len(all_anomalies))
        total_pages = int((total_anomalies + page_size - 1) // page_size) if total_anomalies > 0 else 1
        offset = (page - 1) * page_size
        paginated_anomalies = all_anomalies[offset:offset + page_size]

        response = {
            'status': 'success',
            'anomalies': deep_sanitize(paginated_anomalies),
            'pagination': {
                'page': int(page),
                'page_size': int(page_size),
                'total': total_anomalies,
                'total_pages': total_pages,
                'has_next': int(page) * int(page_size) < total_anomalies,
                'has_prev': int(page) > 1
            }
        }
        return response
    except Exception as e:
        logger.error(f"Reconciliation anomalies failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reconcile/omc-risk-profile", response_model=OmcRiskProfileResponse)
def reconcile_omc_risk_profile(
    materiality: float = Query(100000, description="Minimum leakage amount to flag (KSh)"),
    _: User = Depends(require_permission("view_omc_risk_profile")),
):
    try:
        cache_key = f"metrics_{materiality}"
        cached = get_cached_result(cache_key)
        if cached:
            logger.info(f"✅ OMC Risk Profile cache hit for materiality={materiality}")
            return {
                'status': 'success',
                'omc_risk_profile': cached.get('omc_risk_profile', [])
            }

        logger.info(f"🔄 OMC Risk Profile cache miss – running reconciliation...")
        result = run_reconciliation(materiality=materiality)
        metrics_data = {
            'metrics': result['metrics'],
            'summary': result['summary'],
            'performance': result['performance'],
            'data_quality': result['data_quality'],
            'ebilling_status': result.get('ebilling_status'),
            'duplicate_anomalies': result.get('duplicate_anomalies', []),
            'omc_risk_profile': result.get('omc_risk_profile', []),
            'anomalies': result.get('anomalies', []),
        }
        metrics_data = deep_sanitize(metrics_data)
        set_cached_result(cache_key, metrics_data)
        logger.info(f"✅ OMC Risk Profile cached for materiality={materiality}")

        return {
            'status': 'success',
            'omc_risk_profile': result.get('omc_risk_profile', [])
        }
    except Exception as e:
        logger.error(f"Reconciliation OMC risk profile failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 2. UPLOAD (CSV) – WITH DATABASE PERSISTENCE AND COLUMN DROPPING
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
    try:
        # --- Read CSVs ---
        dispatches_df = pd.read_csv(io.StringIO(dispatches_file.file.read().decode('utf-8')))
        invoices_df = pd.read_csv(io.StringIO(invoices_file.file.read().decode('utf-8')))
        payments_df = pd.read_csv(io.StringIO(payments_file.file.read().decode('utf-8')))

        # --- Convert numeric columns ---
        for col in ['value_kes', 'volume_liters', 'transport_tariff_kes', 'storage_tariff_kes']:
            if col in dispatches_df.columns:
                dispatches_df[col] = pd.to_numeric(dispatches_df[col], errors='coerce').fillna(0)
        for col in ['value_kes']:
            if col in invoices_df.columns:
                invoices_df[col] = pd.to_numeric(invoices_df[col], errors='coerce').fillna(0)
            if col in payments_df.columns:
                payments_df[col] = pd.to_numeric(payments_df[col], errors='coerce').fillna(0)

        # --- Validate columns ---
        required_disp = ['dispatch_id', 'value_kes']
        missing = [c for c in required_disp if c not in dispatches_df.columns]
        if missing:
            raise HTTPException(400, f"Dispatches missing: {missing}")
        if not any(col in dispatches_df.columns for col in ['customer_name', 'customer']):
            raise HTTPException(400, "Dispatches must have 'customer_name' or 'customer'.")
        required_inv = ['invoice_id', 'dispatch_id', 'value_kes']
        missing = [c for c in required_inv if c not in invoices_df.columns]
        if missing:
            raise HTTPException(400, f"Invoices missing: {missing}")
        required_pay = ['invoice_id', 'value_kes']
        missing = [c for c in required_pay if c not in payments_df.columns]
        if missing:
            raise HTTPException(400, f"Payments missing: {missing}")

        # --- 🔥 Drop columns that don't exist in the database schema ---
        for col in ['installment_number', 'total_installments']:
            if col in payments_df.columns:
                payments_df.drop(columns=[col], inplace=True)

        # --- 🔥 PERSIST UPLOADED DATA TO DATABASE (overwrite tables) ---
        engine = get_engine()
        with engine.begin() as conn:
            # Truncate (CASCADE handles foreign keys)
            conn.execute(text("TRUNCATE TABLE dispatches RESTART IDENTITY CASCADE"))
            conn.execute(text("TRUNCATE TABLE invoices RESTART IDENTITY CASCADE"))
            conn.execute(text("TRUNCATE TABLE payments RESTART IDENTITY CASCADE"))
            # Insert new data
            dispatches_df.to_sql('dispatches', conn, if_exists='append', index=False)
            invoices_df.to_sql('invoices', conn, if_exists='append', index=False)
            payments_df.to_sql('payments', conn, if_exists='append', index=False)
        logger.info(f"✅ Uploaded {len(dispatches_df)} dispatches, {len(invoices_df)} invoices, {len(payments_df)} payments to DB")

        # --- Run reconciliation on the NEW database data ---
        result = run_reconciliation(materiality=materiality)
        update_feed(result.get('anomalies', []))
        invalidate_cache()
        logger.info("✅ Cache invalidated after upload")

        # --- Paginate anomalies from the result ---
        all_anomalies = result.get('anomalies', [])
        total_anomalies = int(len(all_anomalies))
        total_pages = int((total_anomalies + page_size - 1) // page_size) if total_anomalies > 0 else 1
        offset = (page - 1) * page_size
        paginated_anomalies = all_anomalies[offset:offset + page_size] if user.has_permission("view_anomaly_table") else []

        raw_response = {
            'metrics': result['metrics'],
            'anomalies': paginated_anomalies,
            'summary': result['summary'],
            'performance': result['performance'],
            'data_quality': result['data_quality'],
            'ebilling_status': result.get('ebilling_status'),
            'duplicate_anomalies': result.get('duplicate_anomalies', []),
            'omc_risk_profile': result.get('omc_risk_profile', []) if user.has_permission("view_omc_risk_profile") else []
        }

        sanitized_data = deep_sanitize(raw_response)

        if 'metrics' in sanitized_data:
            for key in ['total_anomalies', 'critical_count', 'high_risk_count', 'total_dispatches', 'total_invoices', 'total_payments']:
                if key in sanitized_data['metrics']:
                    sanitized_data['metrics'][key] = int(sanitized_data['metrics'][key])
        if 'summary' in sanitized_data:
            for key in ['total_dispatches', 'total_invoices', 'total_payments', 'total_anomalies']:
                if key in sanitized_data['summary']:
                    sanitized_data['summary'][key] = int(sanitized_data['summary'][key])

        pagination = {
            'page': int(page),
            'page_size': int(page_size),
            'total': total_anomalies,
            'total_pages': total_pages,
            'has_next': int(page) * int(page_size) < total_anomalies,
            'has_prev': int(page) > 1
        }

        processing_time = result['performance']['processing_time_seconds']

        final_response = {
            'status': 'success',
            'data': sanitized_data,
            'pagination': pagination,
            'message': f'✅ Uploaded and processed {len(dispatches_df)} dispatches in {processing_time:.2f}s. Found {total_anomalies} anomalies, {sanitized_data["metrics"]["critical_count"]} critical.'
        }

        final_response = deep_sanitize(final_response)
        return final_response

    except pd.errors.EmptyDataError:
        raise HTTPException(400, "One of the uploaded files is empty.")
    except pd.errors.ParserError as e:
        raise HTTPException(400, f"CSV parsing error: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload reconciliation failed: {e}", exc_info=True)
        raise HTTPException(500, detail=str(e))


# ============================================================================
# 3. TEMPLATE DOWNLOAD
# ============================================================================

@router.get("/reconcile/template/{file_type}")
async def download_template(file_type: str, _: User = Depends(require_permission("upload_csv"))):
    if file_type not in ["dispatches", "invoices", "payments"]:
        raise HTTPException(400, "Invalid file type.")
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
            "value_kes": [1500000]
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
def sync_anomalies(db: Session = Depends(get_db), user: User = Depends(require_permission("manage_ebilling"))):
    try:
        result = run_reconciliation()
        pending = [a for a in result.get('anomalies', []) if a.get('ebilling_status') == 'Pending']
        sync_result = sync_anomalies_to_ebilling(pending)
        log_action(db, actor_user_id=user.id, action="ebilling.sync", target_type="sync_task",
                   after={"pending_count": len(pending), "sync_result": sync_result})
        db.commit()
        return {'status': 'success', 'sync_result': sync_result, 'pending_count': len(pending)}
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        raise HTTPException(500, detail=str(e))


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
        invalidate_cache()
        logger.info(f"✅ Cache invalidated after resolving anomaly {dispatch_id}")
        return result
    except Exception as e:
        logger.error(f"Update failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/reconcile/export")
def export_report(materiality: float = Query(100000), _: User = Depends(require_permission("export_reports"))):
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
        raise HTTPException(500, detail=str(e))