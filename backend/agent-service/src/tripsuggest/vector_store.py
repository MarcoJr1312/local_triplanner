"""pgvector-backed place/interest index for the suggestions agent.

The local runner has no Chroma server and no model download:

- ``agent_embeddings`` holds one row per place, interest term or transient query.
- ``agent_index_state`` stores the backend ``contentHash`` per destination, so
  re-indexing only happens when the places cache actually changed.
- Embeddings are 384-dim from a deterministic hashing embedder (offline).
- Query rows use ``q-<sessionId>-<n>`` ids so :func:`purge_session` can remove
  them without touching places or interests.

All distances are cosine (``<=>``); ``score_from_distance`` keeps its meaning.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Sequence

import numpy as np
import psycopg
from psycopg_pool import ConnectionPool

from tripsuggest.interests import interest_id, mean_vector, normalize_terms
from tripsuggest.settings import get_settings

EMBEDDING_DIM = 384
TOP_K = 5

Embedder = Callable[[Sequence[str]], Sequence[Sequence[float]]]

_embedder: Embedder | None = None
_pool: ConnectionPool | None = None


def _default_embedder() -> Embedder:
    """Dependency-free hashing embedder for the local demo.

    Hashing trick over lowercased tokens: deterministic, offline, and good
    enough for the seeded Toronto catalogue. Tests inject their own embedder via
    :func:`set_embedder_for_tests`.
    """

    def embed(texts: Sequence[str]) -> Sequence[Sequence[float]]:
        vectors: list[list[float]] = []
        for text in texts:
            vector = [0.0] * EMBEDDING_DIM
            for token in re.findall(r"[a-z0-9]+", text.lower()):
                # Non-cryptographic feature hashing for the offline embedder.
                digest = hashlib.sha1(  # nosemgrep: python.lang.security.insecure-hash-algorithms.insecure-hash-algorithm-sha1
                    token.encode("utf-8"), usedforsecurity=False
                ).digest()
                index = int.from_bytes(digest[:2], "big") % EMBEDDING_DIM
                sign = 1.0 if digest[2] % 2 == 0 else -1.0
                vector[index] += sign
            norm = math.sqrt(sum(value * value for value in vector))
            if norm > 0:
                vector = [value / norm for value in vector]
            vectors.append(vector)
        return vectors

    return embed


def set_embedder_for_tests(embedder: Embedder | None) -> None:
    """Override the embedding function (tests use a deterministic fake)."""
    global _embedder
    _embedder = embedder


def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    if not texts:
        return []
    global _embedder
    if _embedder is None:
        _embedder = _default_embedder()
    vectors = _embedder(list(texts))
    return [[float(value) for value in vector] for vector in vectors]


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(get_settings().database_url, min_size=0, max_size=4, open=True)
    return _pool


def reset_pool() -> None:
    """Close the pool (tests switch databases between runs)."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def ensure_schema() -> None:
    """Create the agent-owned pgvector schema idempotently."""
    with get_pool().connection() as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_embeddings (
              id             text PRIMARY KEY,
              kind           text NOT NULL CHECK (kind IN ('place', 'interest', 'query')),
              destination_id text,
              user_id        text,
              session_id     text,
              document       text NOT NULL,
              metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
              embedding      vector(384) NOT NULL,
              source_version bigint NOT NULL DEFAULT 0,
              deleted        boolean NOT NULL DEFAULT false,
              updated_at     timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        conn.execute(
            "ALTER TABLE agent_embeddings ADD COLUMN IF NOT EXISTS source_version bigint NOT NULL DEFAULT 0"
        )
        conn.execute(
            "ALTER TABLE agent_embeddings ADD COLUMN IF NOT EXISTS deleted boolean NOT NULL DEFAULT false"
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_agent_embeddings_destination
              ON agent_embeddings(destination_id, kind)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_agent_embeddings_user
              ON agent_embeddings(user_id, kind)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_agent_embeddings_session
              ON agent_embeddings(session_id)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_agent_embeddings_vector
              ON agent_embeddings USING hnsw (embedding vector_cosine_ops)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_sync_state (
              key        text PRIMARY KEY,
              value      text NOT NULL,
              updated_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )


def set_sync_state(key: str, value: str) -> None:
    with get_pool().connection() as conn:
        conn.execute(
            """
            INSERT INTO agent_sync_state (key, value)
            VALUES (%s, %s)
            ON CONFLICT (key) DO UPDATE
              SET value = EXCLUDED.value, updated_at = now()
            """,
            (key, value),
        )


def get_sync_state(key: str) -> str | None:
    with get_pool().connection() as conn:
        row = conn.execute(
            "SELECT value FROM agent_sync_state WHERE key = %s", (key,)
        ).fetchone()
    return str(row[0]) if row else None


def ping() -> None:
    with get_pool().connection() as conn:
        conn.execute("SELECT 1")


def list_active_place_versions() -> dict[str, int]:
    with get_pool().connection() as conn:
        rows = conn.execute(
            """
            SELECT id, source_version FROM agent_embeddings
            WHERE kind = 'place' AND deleted = false
            """
        ).fetchall()
    return {str(row[0]): int(row[1]) for row in rows}


def count_places() -> int:
    with get_pool().connection() as conn:
        row = conn.execute(
            "SELECT count(*) FROM agent_embeddings WHERE kind = 'place' AND deleted = false"
        ).fetchone()
    return int(row[0]) if row else 0


def list_place_versions() -> dict[str, int]:
    with get_pool().connection() as conn:
        rows = conn.execute(
            "SELECT id, source_version FROM agent_embeddings WHERE kind = 'place'"
        ).fetchall()
    return {str(row[0]): int(row[1]) for row in rows}


def _vector_literal(values: Iterable[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in values) + "]"


def _parse_vector(value: Any) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return [float(v) for v in value]
    try:
        parsed = json.loads(str(value))
    except ValueError:
        return None
    return [float(v) for v in parsed] if isinstance(parsed, list) else None


def _float_or_zero(value: Any) -> float:
    try:
        if value is None:
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _document(place: dict[str, Any]) -> str:
    """Flatten a place into one searchable document (same format as before)."""
    parts: list[str] = []
    name = (place.get("name") or "").strip()
    if name:
        parts.append(name)
    category = (place.get("category") or "").strip()
    if category:
        parts.append(category)

    description = (place.get("description") or "").strip()
    tags = place.get("tags") or []
    if not tags and place.get("tags_json"):
        try:
            parsed = json.loads(str(place.get("tags_json")))
            tags = parsed if isinstance(parsed, list) else []
        except ValueError:
            tags = []
    tag_text = ", ".join(t for t in tags if isinstance(t, str) and t.strip())
    if description:
        parts.append(description)
    elif tag_text:
        parts.append(tag_text)

    rating = place.get("rating")
    cost = place.get("cost")
    bits: list[str] = []
    if rating is not None:
        bits.append(f"rating {rating}")
    if cost is not None:
        bits.append(f"cost {cost}")
    if bits:
        parts.append(", ".join(bits))

    return ". ".join(parts).strip()


def _metadata(place: dict[str, Any]) -> dict[str, Any]:
    return {
        "placeId": str(place.get("id") or ""),
        "name": (place.get("name") or "").strip(),
        "category": (place.get("category") or "").strip(),
        "rating": _float_or_zero(place.get("rating")),
        "cost": _float_or_zero(place.get("cost")),
        "lat": place.get("lat"),
        "lng": place.get("lng"),
        "address": place.get("address"),
        "description": place.get("description"),
    }


@dataclass(frozen=True)
class DestinationIndex:
    destination_id: str
    content_hash: str


def _destination_for(place: dict[str, Any], fallback: str | None = None) -> str | None:
    value = place.get("parent_id") or place.get("destination_id") or place.get("slug") or fallback
    return str(value) if value else None


def _version_for(place: dict[str, Any]) -> int:
    try:
        return max(int(place.get("version") or 0), 0)
    except (TypeError, ValueError):
        return 0


def upsert_locations(places: Sequence[dict[str, Any]]) -> int:
    """Upsert place documents into the agent index (idempotent by version)."""
    rows: list[tuple[str, str | None, str, dict[str, Any], list[float], int]] = []
    for place in places:
        place_id = str(place.get("id") or "").strip()
        if not place_id:
            continue
        destination_id = _destination_for(place)
        rows.append(
            (
                place_id,
                destination_id,
                _document(place),
                _metadata(place),
                embed_texts([_document(place)])[0],
                _version_for(place),
            )
        )
    if not rows:
        return 0

    written = 0
    with get_pool().connection() as conn:
        with conn.transaction():
            for place_id, destination_id, document, metadata, vector, version in rows:
                result = conn.execute(
                    """
                    INSERT INTO agent_embeddings
                      (id, kind, destination_id, document, metadata, embedding,
                       source_version, deleted)
                    VALUES (%s, 'place', %s, %s, %s::jsonb, %s::vector, %s, false)
                    ON CONFLICT (id) DO UPDATE SET
                      destination_id = EXCLUDED.destination_id,
                      document = EXCLUDED.document,
                      metadata = EXCLUDED.metadata,
                      embedding = EXCLUDED.embedding,
                      source_version = EXCLUDED.source_version,
                      deleted = false,
                      updated_at = now()
                    WHERE EXCLUDED.source_version > agent_embeddings.source_version
                    """,
                    (
                        place_id,
                        destination_id,
                        document,
                        json.dumps(metadata),
                        _vector_literal(vector),
                        version,
                    ),
                )
                if result.rowcount:
                    written += 1
    return written


def delete_location(location_id: str, version: int) -> None:
    """Tombstone a location; a later higher version can resurrect it."""
    zero = _vector_literal([0.0] * EMBEDDING_DIM)
    with get_pool().connection() as conn:
        conn.execute(
            """
            INSERT INTO agent_embeddings
              (id, kind, destination_id, document, metadata, embedding,
               source_version, deleted)
            VALUES (%s, 'place', NULL, '', '{}'::jsonb, %s::vector, %s, true)
            ON CONFLICT (id) DO UPDATE SET
              deleted = true,
              source_version = EXCLUDED.source_version,
              document = '',
              metadata = '{}'::jsonb,
              embedding = EXCLUDED.embedding,
              updated_at = now()
            WHERE EXCLUDED.source_version >= agent_embeddings.source_version
            """,
            (location_id, zero, max(int(version), 0)),
        )


def _destination_place_ids(destination_id: str) -> dict[str, int]:
    with get_pool().connection() as conn:
        rows = conn.execute(
            """
            SELECT id, source_version FROM agent_embeddings
            WHERE kind = 'place' AND destination_id = %s
            """,
            (destination_id,),
        ).fetchall()
    return {str(row[0]): int(row[1]) for row in rows}


def apply_snapshot(places: Sequence[dict[str, Any]]) -> dict[str, int]:
    """Upsert a full snapshot and tombstone rows missing from it."""
    incoming = {
        str(place.get("id")): place
        for place in places
        if place.get("id") is not None
    }
    upserted = upsert_locations(list(incoming.values()))

    existing = list_active_place_versions()
    deleted = 0
    for location_id, version in existing.items():
        if location_id in incoming:
            continue
        delete_location(location_id, version + 1)
        deleted += 1

    set_sync_state("bootstrap_complete", "true")
    set_sync_state("last_snapshot_at", datetime.now(timezone.utc).isoformat())
    return {"upserted": upserted, "deleted": deleted, "total": len(incoming)}


def ensure_indexed(
    destination_id: str,
    places: list[dict[str, Any]],
    content_hash: str,
) -> DestinationIndex:
    """Compatibility helper for the old cache-based tests.

    Production sync uses :func:`apply_snapshot` and :func:`upsert_locations`.
    """
    state_key = f"destination:{destination_id}"
    current = _destination_place_ids(destination_id)
    if get_sync_state(state_key) == content_hash and current:
        return DestinationIndex(destination_id, content_hash)

    prepared = [
        {
            **place,
            "parent_id": place.get("parent_id") or destination_id,
        }
        for place in places
    ]
    upsert_locations(prepared)

    incoming = {str(place.get("id")) for place in prepared if place.get("id") is not None}
    for place_id, version in _destination_place_ids(destination_id).items():
        if place_id not in incoming:
            delete_location(place_id, version + 1)

    set_sync_state(state_key, content_hash)
    return DestinationIndex(destination_id, content_hash)


def embed_query(
    index: DestinationIndex,
    query_text: str,
    session_id: str,
    top_k: int = TOP_K,
) -> list[dict[str, Any]]:
    """Store the transient query and return the top-k places for it."""
    if not query_text.strip():
        return []
    qid = f"q-{session_id}-0"
    vector = _vector_literal(embed_texts([query_text])[0])

    with get_pool().connection() as conn:
        conn.execute(
            """
            INSERT INTO agent_embeddings
              (id, kind, destination_id, session_id, document, metadata, embedding)
            VALUES (%s, 'query', %s, %s, %s, '{}'::jsonb, %s::vector)
            ON CONFLICT (id) DO UPDATE SET
              document = EXCLUDED.document,
              embedding = EXCLUDED.embedding,
              updated_at = now()
            """,
            (qid, index.destination_id, session_id, query_text, vector),
        )
        rows = conn.execute(
            """
            SELECT id, metadata, embedding <=> %s::vector AS distance
            FROM agent_embeddings
            WHERE destination_id = %s AND kind = 'place' AND deleted = false
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (vector, index.destination_id, vector, top_k),
        ).fetchall()

    return [
        {
            "id": row[0],
            "name": (row[1] or {}).get("name", ""),
            "category": (row[1] or {}).get("category", ""),
            "rating": (row[1] or {}).get("rating"),
            "cost": (row[1] or {}).get("cost"),
            "distance": float(row[2]) if row[2] is not None else None,
        }
        for row in rows
    ]


def purge_session(index: DestinationIndex, session_id: str) -> list[str]:
    """Delete the transient query rows for a session."""
    with get_pool().connection() as conn:
        rows = conn.execute(
            "DELETE FROM agent_embeddings WHERE kind = 'query' AND session_id = %s RETURNING id",
            (session_id,),
        ).fetchall()
    return [row[0] for row in rows]


def sync_user_interests(user_id: str, terms: list[str]) -> dict[str, int]:
    """Idempotently reconcile a user's interest terms."""
    user = (user_id or "").strip()
    if not user:
        raise ValueError("userId required")

    normalized = normalize_terms(terms)
    desired = {interest_id(user, term): term for term in normalized}

    with get_pool().connection() as conn:
        existing_rows = conn.execute(
            "SELECT id FROM agent_embeddings WHERE user_id = %s AND kind = 'interest'",
            (user,),
        ).fetchall()
        existing = {row[0] for row in existing_rows}

        missing = {doc_id: term for doc_id, term in desired.items() if doc_id not in existing}
        stale = [doc_id for doc_id in existing if doc_id not in desired and doc_id.startswith("ui-")]

        vectors = embed_texts(list(missing.values()))
        with conn.transaction():
            for (doc_id, term), vector in zip(missing.items(), vectors):
                conn.execute(
                    """
                    INSERT INTO agent_embeddings
                      (id, kind, user_id, document, metadata, embedding)
                    VALUES (%s, 'interest', %s, %s, %s::jsonb, %s::vector)
                    ON CONFLICT (id) DO UPDATE SET
                      document = EXCLUDED.document,
                      metadata = EXCLUDED.metadata,
                      embedding = EXCLUDED.embedding,
                      updated_at = now()
                    """,
                    (doc_id, user, term, json.dumps({"user_id": user, "term": term}), _vector_literal(vector)),
                )
            if stale:
                conn.execute(
                    "DELETE FROM agent_embeddings WHERE id = ANY(%s) AND kind = 'interest'",
                    (stale,),
                )

    return {"synced": len(missing), "deleted": len(stale)}


def get_user_interest_entries(user_id: str) -> list[dict[str, Any]]:
    """Return ``[{id, term, embedding}]`` for a user, ordered by term."""
    with get_pool().connection() as conn:
        rows = conn.execute(
            """
            SELECT id, metadata->>'term', embedding
            FROM agent_embeddings
            WHERE user_id = %s AND kind = 'interest'
            ORDER BY metadata->>'term'
            """,
            (user_id,),
        ).fetchall()
    return [
        {"id": row[0], "term": row[1] or "", "embedding": _parse_vector(row[2])}
        for row in rows
    ]


def get_user_interest_terms(user_id: str) -> list[str]:
    return [entry["term"] for entry in get_user_interest_entries(user_id) if entry["term"]]


def user_interest_vector(user_id: str) -> np.ndarray | None:
    entries = get_user_interest_entries(user_id)
    return mean_vector(entry["embedding"] for entry in entries if entry["embedding"] is not None)


def query_places_by_vector(
    destination_id: str,
    vector: Any,
    n_results: int,
) -> list[dict[str, Any]]:
    if n_results <= 0:
        return []
    literal = _vector_literal(vector)
    with get_pool().connection() as conn:
        rows = conn.execute(
            """
            SELECT id, metadata, embedding <=> %s::vector AS distance
            FROM agent_embeddings
            WHERE destination_id = %s AND kind = 'place' AND deleted = false
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (literal, destination_id, literal, n_results),
        ).fetchall()
    return [
        {
            "id": row[0],
            "metadata": row[1] or {},
            "distance": float(row[2]) if row[2] is not None else None,
        }
        for row in rows
    ]


def interest_boost_places(
    index: DestinationIndex,
    terms: list[str],
    per_term: int = 3,
    max_terms: int = 5,
) -> list[dict[str, Any]]:
    """Top places per interest, de-duplicated (shape matches embed_query)."""
    boost: list[dict[str, Any]] = []
    seen: set[str] = set()
    for term in normalize_terms(terms)[:max_terms]:
        rows = query_places_by_vector(index.destination_id, embed_texts([term])[0], per_term + 5)
        added = 0
        for row in rows:
            if row["id"] in seen:
                continue
            meta = row["metadata"] or {}
            boost.append(
                {
                    "id": row["id"],
                    "name": meta.get("name", ""),
                    "category": meta.get("category", ""),
                    "rating": meta.get("rating"),
                    "cost": meta.get("cost"),
                    "distance": row["distance"],
                }
            )
            seen.add(row["id"])
            added += 1
            if added >= per_term:
                break
    return boost


def new_session_id() -> str:
    return uuid.uuid4().hex


__all__ = [
    "DestinationIndex",
    "apply_snapshot",
    "count_places",
    "delete_location",
    "embed_query",
    "embed_texts",
    "ensure_indexed",
    "ensure_schema",
    "get_pool",
    "get_sync_state",
    "get_user_interest_entries",
    "get_user_interest_terms",
    "interest_boost_places",
    "list_place_versions",
    "list_active_place_versions",
    "new_session_id",
    "ping",
    "purge_session",
    "query_places_by_vector",
    "reset_pool",
    "set_embedder_for_tests",
    "set_sync_state",
    "sync_user_interests",
    "upsert_locations",
    "user_interest_vector",
]
