"""Prompt-driven place enrichment for weak vector matches."""

from __future__ import annotations

import logging
from typing import Any

from tripsuggest.interests import score_from_distance
from tripsuggest.settings import get_settings
from tripsuggest.sync_clients import LocationsClient, SyncClientError
from tripsuggest.vector_store import (
    DestinationIndex,
    TOP_K,
    embed_query,
    upsert_locations,
)

logger = logging.getLogger("tripsuggest.enrichment")

_locations = LocationsClient()


def best_score(results: list[dict[str, Any]]) -> int:
    distances = [
        row.get("distance")
        for row in results
        if row.get("distance") is not None
    ]
    if not distances:
        return 0
    return score_from_distance(min(distances))


def should_enrich(results: list[dict[str, Any]], top_k: int = TOP_K) -> bool:
    return len(results) < top_k or best_score(results) < get_settings().match_threshold


def search_with_enrichment(
    destination_id: str,
    query_text: str,
    session_id: str,
    *,
    lat: float | None = None,
    lng: float | None = None,
    top_k: int = TOP_K,
) -> list[dict[str, Any]]:
    """Vector search; on a weak result ask locations once and re-query."""
    index = DestinationIndex(destination_id, "")
    results = embed_query(index, query_text, session_id, top_k)
    if not should_enrich(results, top_k):
        return results

    settings = get_settings()
    try:
        extra = _locations.search(
            query_text,
            lat=lat,
            lng=lng,
            limit=settings.enrich_limit,
        )
    except SyncClientError as error:
        logger.warning("locations enrichment skipped: %s", error)
        return results

    if not extra:
        return results

    logger.info("locations enrichment q=%r extra=%d", query_text[:80], len(extra))
    try:
        upsert_locations(extra)
    except Exception:
        logger.exception("failed to index enriched locations")
        return results

    return embed_query(index, query_text, session_id, top_k)
