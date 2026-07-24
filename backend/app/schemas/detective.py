"""
Pydantic response schemas for routes/detective.py.

Field list matches app/services/detective_service.py's
compute_omc_risk_features() output exactly. Every feature except omc_id is
Optional: an OMC with zero dispatches/invoices/payments (or no
quota_ledger row) gets NaN for the affected features, not a crash — NaN
serializes as JSON null through these Optional fields.
"""
from typing import Optional

from pydantic import BaseModel


class OmcRiskFeatures(BaseModel):
    omc_id: str
    ghost_load_rate: Optional[float] = None
    unmatched_payment_rate: Optional[float] = None
    product_mismatch_rate: Optional[float] = None
    value_delta_zscore: Optional[float] = None
    depot_concentration: Optional[float] = None
    depot_concentration_trailing_30d: Optional[float] = None
    depot_concentration_prior_30d: Optional[float] = None
    aging_severity: Optional[float] = None
    quota_utilization_pct: Optional[float] = None


class OmcRiskDetail(OmcRiskFeatures):
    """OmcRiskFeatures + community info from graph_engine. Both community
    fields are None if community detection hasn't been run / doesn't
    place this OMC in any community — this endpoint (GET /api/graph/omc/
    {omc_id}) still returns the base features either way, it just can't
    add graph context on top."""

    community_id: Optional[int] = None
    community_aggregate_risk_score: Optional[float] = None
