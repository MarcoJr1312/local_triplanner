"""Internal locations and broker clients for the agent sync loops."""

from __future__ import annotations

from typing import Any

import httpx

from tripsuggest.settings import get_settings


class SyncClientError(Exception):
    """A locations/broker request failed; the caller retries or degrades."""


class LocationsClient:
    def __init__(self, base_url: str | None = None, timeout_ms: int | None = None):
        settings = get_settings()
        self._base_url = (base_url or settings.locations_url).rstrip("/")
        self._token = settings.internal_token
        self._timeout = (timeout_ms or settings.locations_timeout_ms) / 1000

    @property
    def base_url(self) -> str:
        return self._base_url

    def _headers(self) -> dict[str, str]:
        return {"X-Internal-Token": self._token}

    def snapshot(self) -> list[dict[str, Any]]:
        try:
            response = httpx.get(
                f"{self._base_url}/internal/v1/locations",
                headers=self._headers(),
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise SyncClientError(f"locations snapshot failed: {exc}") from exc
        if not response.is_success:
            raise SyncClientError(f"locations snapshot HTTP {response.status_code}")
        payload = response.json()
        items = payload.get("items") if isinstance(payload, dict) else None
        return [row for row in items or [] if isinstance(row, dict) and row.get("id")]

    def search(
        self,
        query: str,
        *,
        lat: float | None = None,
        lng: float | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"q": query, "limit": limit}
        if lat is not None and lng is not None:
            params["lat"] = lat
            params["lng"] = lng
        try:
            response = httpx.get(
                f"{self._base_url}/internal/v1/locations/search",
                params=params,
                headers=self._headers(),
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise SyncClientError(f"locations search failed: {exc}") from exc
        if not response.is_success:
            raise SyncClientError(f"locations search HTTP {response.status_code}")
        payload = response.json()
        items = payload.get("items") if isinstance(payload, dict) else None
        return [row for row in items or [] if isinstance(row, dict) and row.get("id")]


class BrokerClient:
    def __init__(self, base_url: str | None = None, topic: str | None = None):
        settings = get_settings()
        self._base_url = (base_url or settings.broker_url).rstrip("/")
        self.topic = topic or settings.broker_topic

    def _topic_url(self) -> str:
        return f"{self._base_url}/v1/topics/{self.topic}/messages"

    def fetch(self, consumer: str, limit: int = 50, wait_seconds: int = 20) -> list[dict[str, Any]]:
        try:
            response = httpx.get(
                self._topic_url(),
                params={"consumer": consumer, "limit": limit, "wait": wait_seconds},
                timeout=wait_seconds + 10,
            )
        except httpx.HTTPError as exc:
            raise SyncClientError(f"broker fetch failed: {exc}") from exc
        if not response.is_success:
            raise SyncClientError(f"broker fetch HTTP {response.status_code}")
        payload = response.json()
        messages = payload.get("messages") if isinstance(payload, dict) else None
        return [row for row in messages or [] if isinstance(row, dict)]

    def ack(self, consumer: str, offset: int) -> None:
        try:
            response = httpx.post(
                f"{self._base_url}/v1/topics/{self.topic}/ack",
                json={"consumer": consumer, "offset": offset},
                timeout=10,
            )
        except httpx.HTTPError as exc:
            raise SyncClientError(f"broker ack failed: {exc}") from exc
        if not response.is_success:
            raise SyncClientError(f"broker ack HTTP {response.status_code}")
