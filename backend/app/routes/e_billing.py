from fastapi import APIRouter, Depends, HTTPException, Query, Body, BackgroundTasks
from sqlalchemy.orm import Session
from app.core.dependencies import get_db, require_permission
from app.models.user import User
from app.services.audit_service import log_action
from app.services.e_billing import (
    sync_invoices_to_ebilling,
    get_ebilling_status,          # kept for connection info
    get_ebilling_sync_logs,
    retry_failed_sync,
    get_pending_invoices,
    handle_webhook,
    get_ebilling_reconciliation,
    check_failure_rate,
    run_sync_task,
    get_task_status,
    get_ebilling_sync_logs_paginated,
    get_pending_invoices_paginated,
    invalidate_total_count_cache
)
from app.schemas.e_billing import (
    EBillingStatusResponse,
    EBillingSyncResult,
    EBillingAsyncSyncResponse,
    EBillingTaskStatus,
    EBillingLogsResponse,
    EBillingLogsPaginatedResponse,
    EBillingRetryResponse,
    EBillingPendingResponse,
    EBillingPendingPaginatedResponse,
    EBillingWebhookResponse,
    EBillingReconciliationResponse,
    EBillingMonitorResponse,
    EBillingCacheRefreshResponse,
)
from app.core.cache import get_cached_result, set_cached_result
from app.services.reconciliation import run_reconciliation
import uuid
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# HELPER: Get anomalies from cache (or run reconciliation)
# ============================================================================

def _get_anomalies(materiality: float = 100000):
    """
    Retrieve anomalies from cache or run reconciliation.
    Returns: list of anomalies.
    """
    cache_key = f"metrics_{materiality}"
    cached = get_cached_result(cache_key)
    if cached and 'anomalies' in cached:
        logger.info(f"✅ Using cached anomalies for e-billing (materiality={materiality})")
        return cached['anomalies']

    logger.info(f"🔄 E-billing cache miss – running reconciliation (materiality={materiality})")
    result = run_reconciliation(materiality=materiality)
    anomalies = result.get('anomalies', [])
    # Store in cache (same structure as metrics)
    metrics_data = {
        'metrics': result['metrics'],
        'summary': result['summary'],
        'performance': result['performance'],
        'data_quality': result['data_quality'],
        'ebilling_status': result.get('ebilling_status'),
        'duplicate_anomalies': result.get('duplicate_anomalies', []),
        'omc_risk_profile': result.get('omc_risk_profile', []),
        'anomalies': anomalies,
    }
    set_cached_result(cache_key, metrics_data)
    return anomalies


# ============================================================================
# EXISTING ENDPOINTS (modified to use cache where appropriate)
# ============================================================================

@router.get("/e-billing/status", response_model=EBillingStatusResponse)
async def ebilling_status(_=Depends(require_permission("manage_ebilling"))):
    """
    Get E-Billing integration status (uses cached reconciliation data).
    """
    try:
        anomalies = _get_anomalies(materiality=100000)
        pending = [a for a in anomalies if a.get('ebilling_status') == 'Pending']
        synced = [a for a in anomalies if a.get('ebilling_status') == 'Synced']
        total = len(anomalies)

        # Keep the original system connection status
        legacy_status = get_ebilling_status()
        status = {
            'system': legacy_status.get('system', 'KRA iCMS (Simulated)'),
            'connected': legacy_status.get('connected', True),
            'total_pending': len(pending),
            'total_synced': len(synced),
            'total_anomalies': total,
            'last_sync': None  # could pull from logs if needed
        }
        return {'status': 'success', 'integration': status}
    except Exception as e:
        logger.error(f"E-Billing status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/pending", response_model=EBillingPendingResponse)
async def ebilling_pending(_=Depends(require_permission("manage_ebilling"))):
    """
    Get list of pending invoice IDs (capped at 100) from cached anomalies.
    """
    try:
        anomalies = _get_anomalies(materiality=100000)
        pending = [a for a in anomalies if a.get('ebilling_status') == 'Pending']
        invoice_ids = [a.get('invoice_id') for a in pending if a.get('invoice_id')]
        # Remove duplicates and cap at 100
        unique_ids = list(dict.fromkeys(invoice_ids))[:100]
        return {
            'status': 'success',
            'pending_count': len(unique_ids),
            'invoice_ids': unique_ids
        }
    except Exception as e:
        logger.error(f"E-Billing pending error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/reconcile", response_model=EBillingReconciliationResponse)
async def ebilling_reconcile(_=Depends(require_permission("manage_ebilling"))):
    """
    Get E-Billing reconciliation dashboard data from cached anomalies.
    """
    try:
        anomalies = _get_anomalies(materiality=100000)
        total = len(anomalies)
        pending = [a for a in anomalies if a.get('ebilling_status') == 'Pending']
        synced = [a for a in anomalies if a.get('ebilling_status') == 'Synced']
        failed = [a for a in anomalies if a.get('ebilling_status') == 'Failed']

        total_leakage = sum(a.get('leakage_kes', 0) for a in anomalies)
        pending_leakage = sum(a.get('leakage_kes', 0) for a in pending)
        synced_leakage = sum(a.get('leakage_kes', 0) for a in synced)
        failed_leakage = sum(a.get('leakage_kes', 0) for a in failed)

        data = {
            'total_anomalies': total,
            'pending_count': len(pending),
            'synced_count': len(synced),
            'failed_count': len(failed),
            'total_leakage_kes': total_leakage,
            'pending_leakage_kes': pending_leakage,
            'synced_leakage_kes': synced_leakage,
            'failed_leakage_kes': failed_leakage,
            'system': 'KRA iCMS (Simulated)',
            'connected': True,
            'last_sync': None
        }
        return {'status': 'success', 'data': data}
    except Exception as e:
        logger.error(f"Reconciliation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/monitor", response_model=EBillingMonitorResponse)
async def ebilling_monitor(_=Depends(require_permission("manage_ebilling"))):
    """
    Get failure rate monitoring (enhanced with cached anomaly status).
    """
    try:
        # Original monitor logic (based on sync logs)
        data = check_failure_rate()
        # Supplement with counts from cached anomalies
        anomalies = _get_anomalies(materiality=100000)
        pending_anomalies = [a for a in anomalies if a.get('ebilling_status') == 'Pending']
        failed_anomalies = [a for a in anomalies if a.get('ebilling_status') == 'Failed']
        data['pending_anomalies_count'] = len(pending_anomalies)
        data['failed_anomalies_count'] = len(failed_anomalies)
        return {'status': 'success', 'monitoring': data}
    except Exception as e:
        logger.error(f"Monitor error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# UNCHANGED ENDPOINTS (sync, retry, logs, webhook, etc.)
# ============================================================================

@router.post("/e-billing/sync", response_model=EBillingSyncResult)
def sync_ebilling(
    invoice_ids: list[str] = Query(None, description="Optional list of invoice IDs. If empty, syncs all pending."),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("manage_ebilling")),
):
    """
    Trigger synchronous sync of invoices. (Unchanged)
    """
    try:
        result = sync_invoices_to_ebilling(invoice_ids)
        log_action(
            db,
            actor_user_id=user.id,
            action="ebilling.sync",
            target_type="sync_task",
            after=result,
        )
        db.commit()
        return result
    except Exception as e:
        logger.error(f"E-Billing sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/e-billing/sync/async", response_model=EBillingAsyncSyncResponse)
async def sync_ebilling_async(
    background_tasks: BackgroundTasks,
    invoice_ids: list[str] = Query(None, description="Optional list of invoice IDs. If empty, syncs all pending."),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("manage_ebilling")),
):
    """
    Trigger ASYNC sync of pending invoices. (Unchanged)
    """
    try:
        task_id = str(uuid.uuid4())
        background_tasks.add_task(run_sync_task, task_id, invoice_ids)
        log_action(
            db,
            actor_user_id=user.id,
            action="ebilling.sync",
            target_type="sync_task",
            target_id=task_id,
            after={"status": "processing"},
        )
        db.commit()
        return {
            "status": "processing",
            "task_id": task_id,
            "message": "Sync started. Poll /api/e-billing/task/{task_id} for status."
        }
    except Exception as e:
        logger.error(f"Async sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/task/{task_id}", response_model=EBillingTaskStatus)
async def get_task(task_id: str, _=Depends(require_permission("manage_ebilling"))):
    """
    Get the status of a background sync task. (Unchanged)
    """
    status = get_task_status(task_id)
    if status.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Task not found")
    return status


@router.get("/e-billing/logs", response_model=EBillingLogsResponse)
async def ebilling_logs(
    limit: int = Query(50, description="Number of log entries to return", ge=1, le=100),
    _=Depends(require_permission("manage_ebilling")),
):
    """
    Get recent sync logs (capped at 100). (Unchanged)
    """
    try:
        logs = get_ebilling_sync_logs(limit)
        return {'status': 'success', 'logs': logs, 'count': len(logs)}
    except Exception as e:
        logger.error(f"E-Billing logs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/e-billing/retry/{invoice_id}", response_model=EBillingRetryResponse)
def retry_ebilling(
    invoice_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("manage_ebilling")),
):
    """
    Retry a failed sync for a specific invoice. (Unchanged)
    """
    try:
        result = retry_failed_sync(invoice_id)
        log_action(
            db,
            actor_user_id=user.id,
            action="ebilling.retry",
            target_type="invoice",
            target_id=invoice_id,
            after=result,
        )
        db.commit()
        return result
    except Exception as e:
        logger.error(f"E-Billing retry error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/e-billing/webhook", response_model=EBillingWebhookResponse)
async def kra_webhook(payload: dict = Body(...)):
    """
    Simulate KRA's webhook callback. (Unchanged)
    """
    try:
        result = handle_webhook(payload)
        return result
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# PAGINATED ENDPOINTS (unchanged)
# ============================================================================

@router.get("/e-billing/logs/paginated", response_model=EBillingLogsPaginatedResponse)
async def ebilling_logs_paginated(
    page: int = Query(1, description="Page number", ge=1),
    page_size: int = Query(20, description="Items per page", ge=1, le=100),
    _=Depends(require_permission("manage_ebilling")),
):
    """
    Get paginated sync logs. (Unchanged)
    """
    try:
        result = get_ebilling_sync_logs_paginated(page, page_size)
        return {'status': 'success', **result}
    except Exception as e:
        logger.error(f"E-Billing paginated logs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/pending/paginated", response_model=EBillingPendingPaginatedResponse)
async def ebilling_pending_paginated(
    page: int = Query(1, description="Page number", ge=1),
    page_size: int = Query(20, description="Items per page", ge=1, le=100),
    _=Depends(require_permission("manage_ebilling")),
):
    """
    Get paginated list of pending invoices with details. (Unchanged)
    """
    try:
        result = get_pending_invoices_paginated(page, page_size)
        return {'status': 'success', **result}
    except Exception as e:
        logger.error(f"E-Billing pending paginated error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/e-billing/cache/refresh", response_model=EBillingCacheRefreshResponse)
async def refresh_ebilling_cache(_=Depends(require_permission("manage_ebilling"))):
    """
    Manually refresh the total count cache. (Unchanged)
    """
    try:
        invalidate_total_count_cache()
        return {'status': 'success', 'message': 'Cache invalidated'}
    except Exception as e:
        logger.error(f"Cache refresh error: {e}")
        raise HTTPException(status_code=500, detail=str(e))