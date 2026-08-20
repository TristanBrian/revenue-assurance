# backend/app/routes/heatmap.py
from fastapi import APIRouter, Depends, Query
from app.core.dependencies import require_permission
from app.schemas.heatmap import HeatmapResponse
from app.core.cache import get_cached_result, set_cached_result
from app.services.reconciliation import run_reconciliation
from app.models.user import User
import pandas as pd
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/heatmap", response_model=HeatmapResponse)
def heatmap(
    materiality: float = Query(100000, description="Min leakage to include"),
    _=Depends(require_permission("view_heatmap")),
):
    """
    Returns leakage heatmap data: OMC × Product matrix.
    Uses cached reconciliation data to avoid re-running reconciliation.
    """
    try:
        # Try to get full reconciliation result from cache
        cache_key = f"metrics_{materiality}"
        cached = get_cached_result(cache_key)

        if cached and 'anomalies' in cached:
            logger.info(f"✅ Heatmap using cached anomalies for materiality={materiality}")
            anomalies = cached['anomalies']
        else:
            logger.info(f"🔄 Heatmap cache miss – running reconciliation...")
            result = run_reconciliation(materiality=materiality)
            anomalies = result.get('anomalies', [])
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
            logger.info(f"✅ Heatmap cached full result for materiality={materiality}")

        if not anomalies:
            return {
                'status': 'success',
                'data': {'data': [], 'omcs': [], 'products': [], 'total_leakage': 0}
            }

        df = pd.DataFrame(anomalies)

        # Ensure required columns exist
        if 'customer' not in df.columns or 'product' not in df.columns:
            return {
                'status': 'success',
                'data': {'data': [], 'omcs': [], 'products': [], 'total_leakage': 0}
            }

        # Pivot to matrix: rows = OMC, columns = Product, values = leakage
        pivot = df.pivot_table(
            index='customer',
            columns='product',
            values='leakage_kes',
            aggfunc='sum',
            fill_value=0
        )

        # Extract row labels (OMCs) and column labels (products)
        omcs = pivot.index.tolist()
        products = pivot.columns.tolist()

        # Convert pivot to list of lists (matrix)
        data_matrix = pivot.values.tolist()

        # Compute total leakage
        total_leakage = float(pivot.values.sum())

        data = {
            'data': data_matrix,
            'omcs': omcs,
            'products': products,
            'total_leakage': total_leakage
        }

        return {'status': 'success', 'data': data}

    except Exception as e:
        logger.error(f"Heatmap error: {e}", exc_info=True)
        return {
            'status': 'error',
            'message': str(e),
            'data': {'data': [], 'omcs': [], 'products': [], 'total_leakage': 0}
        }