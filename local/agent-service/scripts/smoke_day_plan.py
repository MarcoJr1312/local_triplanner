"""Smoke del endpoint /api/agent/day-plan (M1) via TestClient in-process.

Ejecutar desde ``local/agent-service``:

    uv run python scripts/smoke_day_plan.py

Usa la identidad demo (X-User-Id: demo-user) y el trip de Panama City.
NO reinicia servidores: importa la app y llama el endpoint con TestClient.
"""

from __future__ import annotations

import json
import sys

sys.path.insert(0, "src")

from fastapi.testclient import TestClient

from tripsuggest.main import app

TRIP_ID = "66258d84-4898-440c-8289-6187a1139302"
LOCALE = "es"


def main() -> int:
    client = TestClient(app)
    response = client.post(
        "/api/agent/day-plan",
        json={"tripId": TRIP_ID, "locale": LOCALE},
        headers={"X-User-Id": "demo-user"},
    )
    print("status:", response.status_code)
    payload = response.json()
    if response.status_code != 200:
        print("error:", json.dumps(payload, ensure_ascii=False, indent=2))
        return 1

    plan = payload.get("plan")
    print("plan entries:", len(plan) if isinstance(plan, list) else "NO-LISTA")
    print("answer preview:", (payload.get("answer") or "")[:300])
    print("plan:", json.dumps(plan, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
