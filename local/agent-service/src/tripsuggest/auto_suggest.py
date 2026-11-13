"""Deterministic, non-LLM auto-suggest (M2).

Builds a single query vector from the user's interests (mean pooling + L2
normalization), queries the destination's pgvector index and returns the
requested page with integer cosine scores. No LLM is involved.
"""

from __future__ import annotations

from typing import Any

from tripsuggest.backend import BackendClient
from tripsuggest.interests import score_from_distance
from tripsuggest.vector_store import (
    DestinationIndex,
    ensure_indexed,
    query_places_by_vector,
    user_interest_vector,
)

_Q_DOC_BUFFER = 10


class NoInterestsError(Exception):
    """Raised when the user has no interests indexed."""


def _item(doc_id: str, metadata: dict[str, Any], distance: Any) -> dict[str, Any]:
    meta = metadata or {}
    return {
        "placeId": str(meta.get("placeId") or doc_id),
        "title": str(meta.get("name") or doc_id),
        "category": str(meta.get("category") or "activity"),
        "cost": meta.get("cost"),
        "score": score_from_distance(distance),
    }


def build_auto_suggest(
    user_id: str,
    destination: DestinationIndex,
    offset: int,
    limit: int,
    vector: Any | None = None,
) -> dict[str, Any]:
    """Pure paging/scoring logic over the destination index."""
    if vector is None:
        vector = user_interest_vector(user_id)
    if vector is None:
        raise NoInterestsError(user_id)

    # One extra row decides ``hasMore`` without a second round-trip.
    results = query_places_by_vector(destination.destination_id, vector, offset + limit + 1 + _Q_DOC_BUFFER)
    items = [_item(row["id"], row["metadata"], row["distance"]) for row in results]
    page = items[offset : offset + limit]
    return {
        "items": page,
        "hasMore": len(items) > offset + limit,
        "offset": offset,
    }


def auto_suggest(
    client: BackendClient,
    trip_id: str,
    user_id: str,
    user_email: str | None,
    offset: int,
    limit: int,
) -> dict[str, Any]:
    """Load trip context + places, then run :func:`build_auto_suggest`."""
    context = client.get_trip_context(trip_id, user_id, user_email)
    resolved_user_id = str(context.get("userId") or user_id)

    vector = user_interest_vector(resolved_user_id)
    if vector is None:
        raise NoInterestsError(resolved_user_id)

    destination_id = (context.get("trip") or {}).get("destinationId")
    if not destination_id:
        return {"items": [], "hasMore": False, "offset": offset}

    cache = client.get_places_cache(trip_id, resolved_user_id, user_email)
    destination = ensure_indexed(
        destination_id,
        cache.get("places") or [],
        cache.get("contentHash") or "",
    )
    return build_auto_suggest(resolved_user_id, destination, offset, limit, vector)
