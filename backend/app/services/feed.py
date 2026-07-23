# backend/app/services/feed.py
"""
Live Feed Service – Caches the latest anomalies for real‑time monitoring.
"""
import pandas as pd
from datetime import datetime
from typing import List, Dict
# import sqlite3  # unused – this module is an in-memory cache only
# import os
#
# DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'kpc.db')

# In‑memory cache for the latest anomalies
_latest_feed = {
    'anomalies': [],
    'last_updated': None,
    'total_count': 0
}


def update_feed(anomalies: List[Dict]):
    """Update the live feed cache with the latest anomalies."""
    global _latest_feed
    # Sort anomalies by age (newest first) – age_days ascending means newer
    sorted_anomalies = sorted(anomalies, key=lambda x: x.get('age_days', 9999))
    _latest_feed['anomalies'] = sorted_anomalies[:20]  # Keep latest 20
    _latest_feed['last_updated'] = datetime.now().isoformat()
    _latest_feed['total_count'] = len(anomalies)


def get_feed(limit: int = 20) -> dict:
    """Return the latest anomalies from the cache."""
    return {
        'anomalies': _latest_feed['anomalies'][:limit],
        'last_updated': _latest_feed['last_updated'],
        'total_count': _latest_feed['total_count']
    }