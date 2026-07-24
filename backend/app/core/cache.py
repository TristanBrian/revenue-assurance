"""
Simple in-memory cache for reconciliation results
TTL = 60 seconds
"""
import time
from typing import Optional, Dict, Any

_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 60  # Cache results for 60 seconds


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
