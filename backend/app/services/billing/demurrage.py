import logging
from datetime import datetime, timedelta
import pandas as pd
from typing import Dict, List, Optional
from app.utils.db_connection import get_engine

logger = logging.getLogger(__name__)

# Constants
FREE_TIME_HOURS = 2
DEMURRAGE_RATE_PER_HOUR = 5000  # KES per hour delayed

def calculate_demurrage(gate_in: datetime, gate_out: datetime) -> int:
    """Calculate demurrage penalty based on allowed hours vs actual dwell time."""
    if not gate_in or not gate_out:
        return 0
        
    dwell_time = gate_out - gate_in
    dwell_hours = dwell_time.total_seconds() / 3600.0
    
    if dwell_hours <= FREE_TIME_HOURS:
        return 0
        
    delayed_hours = dwell_hours - FREE_TIME_HOURS
    return int(delayed_hours * DEMURRAGE_RATE_PER_HOUR)

def calculate_demurrage_for_dispatch(dispatch_data: dict) -> dict:
    """Process a single dispatch and return its demurrage charge."""
    gate_in = dispatch_data.get('gate_in_timestamp')
    gate_out = dispatch_data.get('gate_out_timestamp')
    
    if isinstance(gate_in, str):
        gate_in = pd.to_datetime(gate_in)
    if isinstance(gate_out, str):
        gate_out = pd.to_datetime(gate_out)
        
    charge = calculate_demurrage(gate_in, gate_out)
    return {
        'dispatch_id': dispatch_data.get('dispatch_id'),
        'demurrage_charge_kes': charge,
        'dwell_time_hours': round((gate_out - gate_in).total_seconds() / 3600.0, 2) if gate_in and gate_out else 0,
        'free_time_hours': FREE_TIME_HOURS
    }

def process_demurrage_billing(dispatches_df: pd.DataFrame) -> List[Dict]:
    """Process demurrage for all dispatches and mock an invoice generation."""
    logger.info("⏳ Processing automated demurrage billing...")
    results = []
    
    # Process only dispatches with gate_out timestamps
    if 'gate_out_timestamp' not in dispatches_df.columns or 'gate_in_timestamp' not in dispatches_df.columns:
        logger.warning("Missing gate timestamps in dispatches data.")
        return results
        
    completed = dispatches_df.dropna(subset=['gate_in_timestamp', 'gate_out_timestamp'])
    
    for _, row in completed.iterrows():
        dem_data = calculate_demurrage_for_dispatch(row.to_dict())
        if dem_data['demurrage_charge_kes'] > 0:
            dem_data['status'] = 'Pending Demurrage Invoice'
            results.append(dem_data)
            
    logger.info(f"✅ Generated {len(results)} demurrage draft invoices.")
    return results
