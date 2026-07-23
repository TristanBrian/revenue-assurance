from fastapi import APIRouter, HTTPException, Query, Body, BackgroundTasks
from app.services.e_billing import (
    sync_invoices_to_ebilling,
    get_ebilling_status,
    get_ebilling_sync_logs,
    retry_failed_sync,
    get_pending_invoices,
    handle_webhook,
    get_ebilling_reconciliation,
    check_failure_rate,
    run_sync_task,
    get_task_status
)
from app.schemas.e_billing import (
    EBillingStatusResponse,
    EBillingSyncResult,
    EBillingAsyncSyncResponse,
    EBillingTaskStatus,
    EBillingLogsResponse,
    EBillingRetryResponse,
    EBillingPendingResponse,
    EBillingWebhookResponse,
    EBillingReconciliationResponse,
    EBillingMonitorResponse,
)
import uuid
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/e-billing/status", response_model=EBillingStatusResponse)
async def ebilling_status():
    try:
        status = get_ebilling_status()
        return {'status': 'success', 'integration': status}
    except Exception as e:
        logger.error(f"E-Billing status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/e-billing/sync", response_model=EBillingSyncResult)
async def sync_ebilling(
    invoice_ids: list[str] = Query(None, description="Optional list of invoice IDs. If empty, syncs all pending.")
):
    try:
        result = sync_invoices_to_ebilling(invoice_ids)
        return result
    except Exception as e:
        logger.error(f"E-Billing sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/e-billing/sync/async", response_model=EBillingAsyncSyncResponse)
async def sync_ebilling_async(
    background_tasks: BackgroundTasks,
    invoice_ids: list[str] = Query(None, description="Optional list of invoice IDs. If empty, syncs all pending.")
):
    """
    Trigger an ASYNC sync of pending invoices to E-Billing system.
    Returns a task_id immediately – frontend can poll /api/e-billing/task/{task_id} for progress.
    """
    try:
        task_id = str(uuid.uuid4())
        background_tasks.add_task(run_sync_task, task_id, invoice_ids)
        return {
            "status": "processing",
            "task_id": task_id,
            "message": "Sync started. Poll /api/e-billing/task/{task_id} for status."
        }
    except Exception as e:
        logger.error(f"Async sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/task/{task_id}", response_model=EBillingTaskStatus)
async def get_task(task_id: str):
    """
    Get the status of a background sync task.
    Returns progress, status, and result if completed.
    """
    status = get_task_status(task_id)
    if status.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Task not found")
    return status


@router.get("/e-billing/logs", response_model=EBillingLogsResponse)
async def ebilling_logs(
    limit: int = Query(50, description="Number of log entries to return")
):
    try:
        logs = get_ebilling_sync_logs(limit)
        return {'status': 'success', 'logs': logs, 'count': len(logs)}
    except Exception as e:
        logger.error(f"E-Billing logs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/e-billing/retry/{invoice_id}", response_model=EBillingRetryResponse)
async def retry_ebilling(invoice_id: str):
    try:
        result = retry_failed_sync(invoice_id)
        return result
    except Exception as e:
        logger.error(f"E-Billing retry error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/pending", response_model=EBillingPendingResponse)
async def ebilling_pending():
    try:
        pending = get_pending_invoices()
        return {'status': 'success', 'pending_count': len(pending), 'invoice_ids': pending}
    except Exception as e:
        logger.error(f"E-Billing pending error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/e-billing/webhook", response_model=EBillingWebhookResponse)
async def kra_webhook(payload: dict = Body(...)):
    try:
        result = handle_webhook(payload)
        return result
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/reconcile", response_model=EBillingReconciliationResponse)
async def ebilling_reconcile():
    try:
        data = get_ebilling_reconciliation()
        return {'status': 'success', 'data': data}
    except Exception as e:
        logger.error(f"Reconciliation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/monitor", response_model=EBillingMonitorResponse)
async def ebilling_monitor():
    try:
        data = check_failure_rate()
        return {'status': 'success', 'monitoring': data}
    except Exception as e:
        logger.error(f"Monitor error: {e}")
        raise HTTPException(status_code=500, detail=str(e))