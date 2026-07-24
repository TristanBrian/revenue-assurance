# backend/app/routes/feed.py
from fastapi import APIRouter, Depends, Query
from app.core.dependencies import require_permission
from app.services.feed import get_feed, update_feed
from app.services.reconciliation import run_reconciliation
from app.schemas.feed import FeedResponse
from app.core.cache import get_cached_result, set_cached_result
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/feed", response_model=FeedResponse)
def live_feed(
    limit: int = Query(20, description="Number of recent anomalies to return"),
    _=Depends(require_permission("view_live_feed")),
):
    """
    Returns the latest anomalies for the live feed.
    Uses a dedicated cache to avoid running reconciliation on every request.

    - Cache hit: instant response (<10ms)
    - Cache miss: runs reconciliation (2–3s), caches result for 60 seconds
    """
    try:
        # 1. Try to get feed data from the in-memory feed cache (fast, but may be empty)
        feed_data = get_feed(limit)
        if feed_data['anomalies']:
            logger.info("✅ Feed cache hit – returning anomalies")
            return {
                'status': 'success',
                'data': feed_data
            }

        # 2. Feed cache is empty – try reconciliation cache
        cache_key = "reconciliation_for_feed"
        cached = get_cached_result(cache_key)
        if cached:
            logger.info("✅ Reconciliation cache hit – populating feed")
            anomalies = cached.get("anomalies", [])
            update_feed(anomalies)
            feed_data = get_feed(limit)
            return {
                'status': 'success',
                'data': feed_data
            }

        # 3. No cache – run reconciliation and store
        logger.info("🔄 Cache empty – running reconciliation to populate feed...")
        result = run_reconciliation(materiality=100000)
        anomalies = result.get('anomalies', [])

        # Update in-memory feed cache
        update_feed(anomalies)

        # Store reconciliation result in Redis cache for 60 seconds
        set_cached_result(cache_key, {"anomalies": anomalies})
        logger.info("✅ Reconciliation result cached for 60s")

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