# backend/app/routes/heatmap.py
from fastapi import APIRouter, Depends, Query
from app.core.dependencies import require_permission
from app.services.heatmap import get_heatmap_data
from app.schemas.heatmap import HeatmapResponse
from app.core.cache import get_cached_result, set_cached_result
from app.models.user import User
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/heatmap", response_model=HeatmapResponse)
def heatmap(
    materiality: float = Query(0, description="Min leakage to include"),
    _=Depends(require_permission("view_heatmap")),
):
    """
    Returns leakage heatmap data: OMC × Product matrix.
    Cached for 60 seconds to avoid re-running reconciliation.
    """
    try:
        cache_key = f"heatmap_{materiality}"
        cached = get_cached_result(cache_key)
        if cached:
            logger.info(f"✅ Heatmap cache hit for materiality={materiality}")
            return cached

        logger.info(f"🔄 Heatmap cache miss – running reconciliation...")
        data = get_heatmap_data(materiality=materiality)
        response = {
            'status': 'success',
            'data': data
        }
        set_cached_result(cache_key, response)
        logger.info(f"✅ Heatmap cached for materiality={materiality}")
        return response

    except Exception as e:
        logger.error(f"Heatmap error: {e}")
        return {
            'status': 'error',
            'message': str(e),
            'data': {'data': [], 'omcs': [], 'products': [], 'total_leakage': 0}
        }