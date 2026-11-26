"""Metrics endpoint tests for the agent service (no database, no network).

Run without pytest:

    cd backend/agent-service && uv run python tests/test_metrics.py
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tripsuggest.metrics import install_metrics


def main() -> None:
    app = FastAPI()
    install_metrics(app)

    @app.get("/ping")
    def ping() -> dict[str, bool]:
        return {"ok": True}

    with TestClient(app) as client:
        metrics = client.get("/metrics")
        assert metrics.status_code == 200, metrics.text
        assert "text/plain" in metrics.headers["content-type"]
        assert "triplanner_build_info" in metrics.text
        assert "triplanner_http_requests_total" in metrics.text
        assert "triplanner_http_request_duration_seconds" in metrics.text
        assert "triplanner_http_requests_in_flight" in metrics.text
        assert 'service="agent"' in metrics.text
        assert "python_gc_objects_collected_total" in metrics.text
        assert "python_info" in metrics.text

        assert client.get("/ping").status_code == 200
        after = client.get("/metrics")
        assert 'route="/ping"' in after.text, after.text
        assert 'status="200"' in after.text
        assert 'method="GET"' in after.text

        # The endpoint never counts its own scrapes.
        assert 'route="/metrics"' not in after.text

    print("agent metrics tests passed")


if __name__ == "__main__":
    main()
