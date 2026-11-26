"""Background sync: locations snapshot, LocationChanged consumer and reconcile."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from tripsuggest.settings import get_settings
from tripsuggest.sync_clients import BrokerClient, LocationsClient, SyncClientError
from tripsuggest import vector_store

logger = logging.getLogger("tripsuggest.sync")


@dataclass
class SyncHealth:
    bootstrap_complete: bool = False
    last_snapshot_at: str | None = None
    last_event_at: str | None = None
    last_event_offset: int | None = None
    last_error: str | None = None
    indexed_places: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)


class AgentSync:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.locations = LocationsClient(
            self.settings.locations_url, self.settings.locations_timeout_ms
        )
        self.broker = BrokerClient(self.settings.broker_url, self.settings.broker_topic)
        self.health = SyncHealth(
            bootstrap_complete=vector_store.get_sync_state("bootstrap_complete") == "true",
            last_snapshot_at=vector_store.get_sync_state("last_snapshot_at"),
        )
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    def start(self) -> None:
        vector_store.ensure_schema()
        self._stop.clear()
        for target, name in (
            (self._reconcile_loop, "agent-reconcile"),
            (self._consumer_loop, "agent-locations-consumer"),
        ):
            thread = threading.Thread(target=target, name=name, daemon=True)
            thread.start()
            self._threads.append(thread)

    def stop(self) -> None:
        self._stop.set()
        for thread in self._threads:
            thread.join(timeout=2)
        self._threads.clear()

    def bootstrap_once(self) -> dict[str, int]:
        places = self.locations.snapshot()
        result = vector_store.apply_snapshot(places)
        with self.health.lock:
            self.health.bootstrap_complete = True
            self.health.last_snapshot_at = datetime.now(timezone.utc).isoformat()
            self.health.indexed_places = vector_store.count_places()
            self.health.last_error = None
        logger.info(
            "locations snapshot synced: %s places (upserted=%s deleted=%s)",
            result["total"],
            result["upserted"],
            result["deleted"],
        )
        return result

    def reconcile_once(self) -> dict[str, int]:
        return self.bootstrap_once()

    def process_event(self, value: dict[str, Any]) -> None:
        if value.get("type") != "location.changed.v1":
            logger.warning("ignoring unknown location event type=%s", value.get("type"))
            return
        try:
            version = int(value.get("version") or 0)
        except (TypeError, ValueError):
            version = 0
        if value.get("deleted"):
            location_id = str(value.get("locationId") or "")
            if location_id:
                vector_store.delete_location(location_id, version)
            return
        location = value.get("location")
        if not isinstance(location, dict) or not location.get("id"):
            raise ValueError("location event without a location body")
        vector_store.upsert_locations([location])

    def consume_once(self) -> int:
        messages = self.broker.fetch(
            self.settings.broker_consumer,
            limit=50,
            wait_seconds=20,
        )
        processed = 0
        for message in messages:
            offset = int(message.get("offset") or 0)
            value = message.get("value")
            if not isinstance(value, dict):
                logger.warning("ignoring non-object broker message offset=%s", offset)
                self.broker.ack(self.settings.broker_consumer, offset)
                continue
            try:
                self.process_event(value)
            except ValueError as error:
                # Poison message: do not block the consumer forever.
                logger.warning("dropping invalid location event offset=%s: %s", offset, error)
                self.broker.ack(self.settings.broker_consumer, offset)
                continue
            except Exception as error:
                with self.health.lock:
                    self.health.last_error = str(error)
                logger.exception("location event failed offset=%s", offset)
                # No ack: the broker retries at-least-once.
                continue
            self.broker.ack(self.settings.broker_consumer, offset)
            processed += 1
            with self.health.lock:
                self.health.last_event_at = datetime.now(timezone.utc).isoformat()
                self.health.last_event_offset = offset
                self.health.last_error = None
        if processed:
            with self.health.lock:
                self.health.indexed_places = vector_store.count_places()
        return processed

    def ready(self) -> dict[str, Any]:
        try:
            vector_store.ping()
            db = "ok"
        except Exception as error:
            db = "down"
            with self.health.lock:
                self.health.last_error = str(error)
        with self.health.lock:
            return {
                "status": "ready" if db == "ok" and self.health.bootstrap_complete else "not_ready",
                "db": db,
                "bootstrap_complete": self.health.bootstrap_complete,
                "indexed_places": self.health.indexed_places,
                "last_snapshot_at": self.health.last_snapshot_at,
                "last_event_at": self.health.last_event_at,
                "last_event_offset": self.health.last_event_offset,
                "last_error": self.health.last_error,
                "locations_url": self.settings.locations_url,
                "broker_topic": self.settings.broker_topic,
            }

    def _reconcile_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.reconcile_once()
            except Exception as error:
                with self.health.lock:
                    self.health.last_error = str(error)
                logger.warning("locations reconcile failed: %s", error)
            self._stop.wait(self.settings.sync_interval_ms / 1000)

    def _consumer_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.consume_once()
            except SyncClientError as error:
                with self.health.lock:
                    self.health.last_error = str(error)
                logger.warning("broker consumer degraded: %s", error)
                self._stop.wait(2)
            except Exception as error:
                with self.health.lock:
                    self.health.last_error = str(error)
                logger.exception("broker consumer loop failed")
                self._stop.wait(2)
