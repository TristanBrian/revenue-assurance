# backend/app/routes/heatmap.py
from fastapi import APIRouter, Depends, Query
from app.core.dependencies import require_permission
from app.services.heatmap import get_heatmap_data
from app.schemas.heatmap import HeatmapResponse
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/heatmap", response_model=HeatmapResponse)
async def heatmap(
    materiality: float = Query(0, description="Min leakage to include"),
    _=Depends(require_permission("view_heatmap")),
):
    """
    Returns leakage heatmap data: OMC × Product matrix.
    """
    try:
        data = get_heatmap_data(materiality=materiality)
        return {
            'status': 'success',
            'data': data
        }
    except Exception as e:
        logger.error(f"Heatmap error: {e}")
        return {
            'status': 'error',
            'message': str(e),
            'data': {'data': [], 'omcs': [], 'products': [], 'total_leakage': 0}
        }