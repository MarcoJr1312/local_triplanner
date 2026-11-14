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
    }


@dataclass(frozen=True)
class DestinationIndex:
    destination_id: str
    content_hash: str


def ensure_indexed(
    destination_id: str,
    places: list[dict[str, Any]],
    content_hash: str,
) -> DestinationIndex:
    """Re-index a destination only when its content hash changed."""
    with get_pool().connection() as conn:
        state = conn.execute(
            "SELECT content_hash FROM agent_index_state WHERE destination_id = %s",
            (destination_id,),
        ).fetchone()
        count = conn.execute(
            "SELECT count(*) FROM agent_embeddings WHERE destination_id = %s AND kind = 'place'",
            (destination_id,),
        ).fetchone()
        current = int(count[0]) if count else 0

        if state and state[0] == content_hash and current > 0:
            return DestinationIndex(destination_id, content_hash)

        rows = [(str(p["id"]), _document(p), _metadata(p)) for p in places]
        vectors = embed_texts([row[1] for row in rows])

        with conn.transaction():
            conn.execute(
                "DELETE FROM agent_embeddings WHERE destination_id = %s AND kind = 'place'",
                (destination_id,),
            )
            for (place_id, document, metadata), vector in zip(rows, vectors):
                conn.execute(
                    """
                    INSERT INTO agent_embeddings
                      (id, kind, destination_id, document, metadata, embedding)
                    VALUES (%s, 'place', %s, %s, %s::jsonb, %s::vector)
                    ON CONFLICT (id) DO UPDATE SET
                      destination_id = EXCLUDED.destination_id,
                      document = EXCLUDED.document,
                      metadata = EXCLUDED.metadata,
                      embedding = EXCLUDED.embedding,
                      updated_at = now()
                    """,
                    (place_id, destination_id, document, json.dumps(metadata), _vector_literal(vector)),
                )
            conn.execute(
                """
                INSERT INTO agent_index_state (destination_id, content_hash)
                VALUES (%s, %s)
                ON CONFLICT (destination_id) DO UPDATE SET
                  content_hash = EXCLUDED.content_hash,
                  updated_at = now()
                """,
                (destination_id, content_hash),
            )

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
            WHERE destination_id = %s AND kind = 'place'
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
            WHERE destination_id = %s AND kind = 'place'
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
    "embed_query",
    "embed_texts",
    "ensure_indexed",
    "get_pool",
    "get_user_interest_entries",
    "get_user_interest_terms",
    "interest_boost_places",
    "new_session_id",
    "purge_session",
    "query_places_by_vector",
    "reset_pool",
    "set_embedder_for_tests",
    "sync_user_interests",
    "user_interest_vector",
]
