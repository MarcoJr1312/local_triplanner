"""HTTP client for the local backend's internal endpoints (M2/M3).

The backend lives at 127.0.0.1:4000 and exposes ``/internal/*`` endpoints
guarded by ``X-Internal-Token`` (shared secret) and, where membership matters,
``X-User-Id``. This module keeps every backend call in one place so the agent
and its tools never hardcode URLs or headers.
"""

from __future__ import annotations

from typing import Any

import httpx

from tripsuggest.settings import get_settings

DEFAULT_BACKEND_URL = "http://127.0.0.1:4000"


class BackendError(Exception):
    """A non-2xx response from the backend, with a stable machine-readable code."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class BackendClient:
    def __init__(self, base_url: str | None = None):
        resolved = base_url or get_settings().backend_url or DEFAULT_BACKEND_URL
        self._base_url = resolved.rstrip("/")
        self._token = get_settings().internal_token

    def _headers(self, user_id: str | None = None, user_email: str | None = None) -> dict[str, str]:
        headers = {"X-Internal-Token": self._token}
        if user_id:
            headers["X-User-Id"] = user_id
        if user_email:
            headers["X-User-Email"] = user_email
        return headers

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.is_success:
            return
        try:
            payload = response.json()
        except Exception:
            payload = {}
        code = str(payload.get("error") or "BACKEND_ERROR")
        message = str(payload.get("message") or "Error interno del backend")
        raise BackendError(response.status_code, code, message)

    def get_trip_context(self, trip_id: str, user_id: str, user_email: str | None = None) -> dict[str, Any]:
        response = httpx.get(
            f"{self._base_url}/internal/trip-context/{trip_id}",
            headers=self._headers(user_id, user_email),
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def get_places_cache(self, trip_id: str, user_id: str, user_email: str | None = None) -> dict[str, Any]:
        response = httpx.get(
            f"{self._base_url}/internal/places-cache/{trip_id}",
            headers=self._headers(user_id, user_email),
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()

    def search_places(self, query: str, trip_id: str, user_id: str) -> list[dict[str, Any]]:
        response = httpx.post(
            f"{self._base_url}/internal/search-places",
            headers=self._headers(),
            json={"q": query, "tripId": trip_id, "userId": user_id},
            timeout=30,
        )
        self._raise_for_status(response)
        data = response.json()
        return data if isinstance(data, list) else []

    def get_place_details(self, place_id: str) -> dict[str, Any]:
        response = httpx.post(
            f"{self._base_url}/internal/place-details",
            headers=self._headers(),
            json={"placeId": place_id},
            timeout=30,
        )
        self._raise_for_status(response)
        data = response.json()
        return data if isinstance(data, dict) else {}

    def save_chat(
        self,
        trip_id: str,
        user_id: str,
        day: str,
        messages: list[dict[str, str]],
    ) -> dict[str, Any]:
        response = httpx.post(
            f"{self._base_url}/internal/save-chat",
            headers=self._headers(),
            json={"tripId": trip_id, "userId": user_id, "day": day, "messages": messages},
            timeout=20,
        )
        self._raise_for_status(response)
        return response.json()
