# backend/app/routes/reconciliation/heatmap.py
from fastapi import APIRouter, Depends, Query
from app.core.dependencies import require_permission
from app.schemas.reconciliation.heatmap import HeatmapResponse
from app.core.cache import get_cached_result, set_cached_result
from app.services.reconciliation.reconciliation import run_combined_reconciliation
from app.models.auth.user import User
import pandas as pd
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/heatmap", response_model=HeatmapResponse)
def heatmap(
    materiality: float = Query(100000, description="Min leakage to include"),
    direction: str = Query("all", description="inbound | outbound | all — defaults to all"),
    _=Depends(require_permission("view_heatmap")),
):
    """
    Returns leakage heatmap data: rows/columns are 'customer'/'product' as
    labeled generically as they are in the Anomaly schema itself — that's
    OMC x Product for inbound anomalies and Beneficiary x Pillar for
    outbound ones (see _build_outbound_anomaly()'s field-mapping comment
    in services/reconciliation/reconciliation.py). direction="all" pivots
    both together in one matrix, same as reconcile_metrics()'s merged
    totals — the frontend's direction toggle is expected to pass an
    explicit inbound/outbound value whenever mixing rows from two
    different entity types would be confusing to show together.
    Uses cached reconciliation data to avoid re-running reconciliation.
    """
    try:
        # Try to get full reconciliation result from cache
        cache_key = f"metrics_{materiality}_{direction}"
        cached = get_cached_result(cache_key)

        if cached and 'anomalies' in cached:
            logger.info(f"✅ Heatmap using cached anomalies for materiality={materiality}, direction={direction}")
            anomalies = cached['anomalies']
        else:
            logger.info(f"🔄 Heatmap cache miss – running reconciliation...")
            result = run_combined_reconciliation(direction=direction, materiality=materiality)
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