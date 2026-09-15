"""Prometheus request instrumentation for the API."""
import time

from prometheus_client import Counter, Histogram
from starlette.middleware.base import BaseHTTPMiddleware

REQUESTS = Counter(
    "reconova_http_requests_total",
    "HTTP requests handled by the Reconova API",
    ["method", "route", "status"],
)
LATENCY = Histogram(
    "reconova_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "route"],
)


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        route = getattr(request.scope.get("route"), "path", request.url.path)
        REQUESTS.labels(request.method, route, str(response.status_code)).inc()
        LATENCY.labels(request.method, route).observe(time.perf_counter() - started)
        return response
