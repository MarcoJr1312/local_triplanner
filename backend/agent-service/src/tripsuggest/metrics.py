"""Prometheus metrics for the agent service.

The endpoint shares the FastAPI HTTP port and never touches PostgreSQL or the
backend; only HTTP/runtime counters live here.
"""

from __future__ import annotations

import os
import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from starlette.middleware.base import BaseHTTPMiddleware

SERVICE = "agent"
VERSION = os.getenv("SERVICE_VERSION", "dev")
METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"

BUILD_INFO = Gauge(
    "triplanner_build_info",
    "Triplanner build information; always 1.",
    ["service", "version"],
)
BUILD_INFO.labels(service=SERVICE, version=VERSION).set(1)

HTTP_REQUESTS = Counter(
    "triplanner_http_requests_total",
    "Completed HTTP requests.",
    ["service", "method", "route", "status"],
)
HTTP_DURATION = Histogram(
    "triplanner_http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ["service", "method", "route", "status"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60),
)
HTTP_IN_FLIGHT = Gauge(
    "triplanner_http_requests_in_flight",
    "HTTP requests currently being served.",
    ["service"],
)


def _route_label(request: Request) -> str:
    """Return the FastAPI route template, never the raw path or an ID."""
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str) and path:
        return path
    return "other"


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path == "/metrics":
            return await call_next(request)

        method = request.method.upper()
        started = time.perf_counter()
        HTTP_IN_FLIGHT.labels(service=SERVICE).inc()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            HTTP_IN_FLIGHT.labels(service=SERVICE).dec()
            route = _route_label(request)
            labels = {
                "service": SERVICE,
                "method": method,
                "route": route,
                "status": str(status),
            }
            HTTP_REQUESTS.labels(**labels).inc()
            HTTP_DURATION.labels(**labels).observe(time.perf_counter() - started)


def install_metrics(app: FastAPI) -> None:
    """Install the middleware and the `/metrics` route."""
    app.add_middleware(MetricsMiddleware)

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> Response:
        return Response(content=generate_latest(), media_type=METRICS_CONTENT_TYPE)
