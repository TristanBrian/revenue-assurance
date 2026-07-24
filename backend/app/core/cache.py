"""
Simple in-memory cache for reconciliation results.

TTL = 10 minutes. The underlying computation (run_reconciliation) takes
several seconds on this dataset, and the data it reads only changes via an
explicit CSV upload or e-billing sync — both of which already call
invalidate_cache(). A 60s TTL meant every user hit that multi-second cold
path on almost every page load; 10 minutes keeps pages fast while still
bounding how stale a view can get between explicit invalidations.
"""
import time
from typing import Optional, Dict, Any

_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 600


def get_cached_result(key: str) -> Optional[Dict[str, Any]]:
    """Get cached result if not expired."""
    if key in _cache:
        entry = _cache[key]
        if time.time() - entry["timestamp"] < CACHE_TTL_SECONDS:
            return entry["data"]
        else:
            del _cache[key]
    return None


def set_cached_result(key: str, data: Dict[str, Any]) -> None:
    """Store result in cache."""
    _cache[key] = {"timestamp": time.time(), "data": data}


def invalidate_cache() -> None:
    """Clear all cache (call after uploads or data changes)."""
    _cache.clear()
