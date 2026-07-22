# backend/app/routes/feed.py
from fastapi import APIRouter, Query
from app.services.feed import get_feed
from app.services.reconciliation import run_reconciliation
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/feed")
async def live_feed(limit: int = Query(20, description="Number of recent anomalies to return")):
    """
    Returns the latest anomalies for the live feed.
    If the cache is empty, runs reconciliation to populate it.
    """
    try:
        feed_data = get_feed(limit)
        # If cache is empty, run reconciliation to initialize it
        if not feed_data['anomalies']:
            logger.info("Cache empty – running reconciliation to populate feed...")
            result = run_reconciliation(materiality=100000)
            from app.services.feed import update_feed
            update_feed(result.get('anomalies', []))
            feed_data = get_feed(limit)
        return {
            'status': 'success',
            'data': feed_data
        }
    except Exception as e:
        logger.error(f"Live feed error: {e}")
        return {
            'status': 'error',
            'message': str(e),
            'data': {'anomalies': [], 'last_updated': None, 'total_count': 0}
        }