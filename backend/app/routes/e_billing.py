from fastapi import APIRouter, HTTPException, Query
from app.services.e_billing import (
    sync_invoices_to_ebilling,
    get_ebilling_status,
    get_ebilling_sync_logs,
    retry_failed_sync,
    get_pending_invoices
)
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/e-billing/status")
async def ebilling_status():
    """Get detailed E-Billing integration status."""
    try:
        status = get_ebilling_status()
        return {
            'status': 'success',
            'integration': status
        }
    except Exception as e:
        logger.error(f"E-Billing status error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/e-billing/sync")
async def sync_ebilling(
    invoice_ids: list[str] = Query(None, description="Optional list of invoice IDs to sync. If empty, syncs all pending.")
):
    """Trigger a sync of pending invoices to E-Billing system."""
    try:
        result = sync_invoices_to_ebilling(invoice_ids)
        return result
    except Exception as e:
        logger.error(f"E-Billing sync error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/logs")
async def ebilling_logs(
    limit: int = Query(50, description="Number of log entries to return")
):
    """Get recent e-billing sync logs."""
    try:
        logs = get_ebilling_sync_logs(limit)
        return {
            'status': 'success',
            'logs': logs,
            'count': len(logs)
        }
    except Exception as e:
        logger.error(f"E-Billing logs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/e-billing/retry/{invoice_id}")
async def retry_ebilling(invoice_id: str):
    """Retry a failed sync for a specific invoice."""
    try:
        result = retry_failed_sync(invoice_id)
        return result
    except Exception as e:
        logger.error(f"E-Billing retry error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/e-billing/pending")
async def ebilling_pending():
    """Get list of pending invoice IDs."""
    try:
        pending = get_pending_invoices()
        return {
            'status': 'success',
            'pending_count': len(pending),
            'invoice_ids': pending
        }
    except Exception as e:
        logger.error(f"E-Billing pending error: {e}")
        raise HTTPException(status_code=500, detail=str(e))