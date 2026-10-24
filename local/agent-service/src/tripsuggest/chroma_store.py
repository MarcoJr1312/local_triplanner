"""Chroma-backed place index for the suggestions agent (M3/M2).

Layout:

- Persistent client rooted at ``local/agent-service/data/chroma`` (gitignored).
- One collection per destination, named ``dest-<destinationId>``. It is indexed
  from ``GET /internal/places-cache`` and only re-indexed when the backend's
  ``contentHash`` changes (or the collection does not exist yet).
- One collection ``user-interests`` with ``{user_id, term}`` metadata. Ids are
  stable (``ui-<userId>-<sha1(term)[:12]>``) so the backend can re-sync the full
  term list idempotently and the agent can mean-pool the embeddings.
- The user's latest query is stored as a transient document
  ``q-<sessionId>-<n>`` with ``{sessionId, ts}`` metadata, then purged once the
  agent has answered. Place documents are never removed by the purge, and
  ``ui-*`` documents live in a separate collection so they are never touched.

All collections use Chroma's default local embedding function (ONNX MiniLM) and
cosine space, so no extra keys or paid embedding API is needed.
"""

from __future__ import annotations

import hashlib
import time
import uuid
from pathlib import Path
from typing import Any

import chromadb

from tripsuggest.interests import interest_id, mean_vector, normalize_terms

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
CHROMA_DIR = DATA_DIR / "chroma"

TOP_K = 5

INTERESTS_COLLECTION = "user-interests"
INTERESTS_SPACE = "cosine"

_clients: dict[str, chromadb.PersistentClient] = {}


def _float_or_zero(value: Any) -> float:
    try:
        if value is None:
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def get_client(path: str | Path | None = None) -> chromadb.PersistentClient:
    """Return (and lazily create) a persistent Chroma client.

    ``path`` defaults to the service's ``data/chroma`` directory. Tests pass a
    temporary path to avoid touching the real index.
    """
    root = Path(path) if path is not None else CHROMA_DIR
    key = str(root)
    client = _clients.get(key)
    if client is None:
        root.mkdir(parents=True, exist_ok=True)
        client = chromadb.PersistentClient(path=key)
        _clients[key] = client
    return client


def _collection_name(destination_id: str) -> str:
    return f"dest-{destination_id}"


def _is_cosine(collection: chromadb.Collection | None) -> bool:
    metadata = (collection.metadata or {}) if collection is not None else {}
    return metadata.get("hnsw:space") == INTERESTS_SPACE


def _document(place: dict[str, Any]) -> str:
    """Flatten a place into a single searchable text document.

    Format: ``name. category. description/tags. rating/cost``.
    """
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
    price_bits: list[str] = []
    if rating is not None:
        price_bits.append(f"rating {rating}")
    if cost is not None:
        price_bits.append(f"cost {cost}")
    if price_bits:
        parts.append(", ".join(price_bits))

    return ". ".join(parts).strip()


def _metadata(place: dict[str, Any]) -> dict[str, Any]:
    return {
        "placeId": str(place.get("id") or ""),
        "name": (place.get("name") or "").strip(),
        "category": (place.get("category") or "").strip(),
        "rating": _float_or_zero(place.get("rating")),
        "cost": _float_or_zero(place.get("cost")),
    }


def ensure_indexed(
    destination_id: str,
    places: list[dict[str, Any]],
    content_hash: str,
    client: chromadb.PersistentClient | None = None,
) -> chromadb.Collection:
    """Return the destination collection, re-indexing it when needed.

    Collections are created with cosine space so auto-suggest can turn
    ``distance`` into ``similarity = 1 - distance``. Legacy L2 collections are
    rebuilt once (same content hash) to keep the score semantics correct.
    """
    client = client or get_client()
    name = _collection_name(destination_id)

    try:
        existing = client.get_collection(name=name)
    except Exception:
        existing = None
    stored_hash = existing.metadata.get("content_hash") if existing and existing.metadata else None

    if (
        existing is None
        or stored_hash != content_hash
        or existing.count() == 0
        or not _is_cosine(existing)
    ):
        if existing is not None:
            client.delete_collection(name)
        collection = client.create_collection(
            name=name,
            metadata={"hnsw:space": INTERESTS_SPACE, "content_hash": content_hash},
        )
        if places:
            collection.upsert(
                ids=[p["id"] for p in places],
                documents=[_document(p) for p in places],
                metadatas=[_metadata(p) for p in places],
            )
        return collection

    return existing


def embed_query(
    collection: chromadb.Collection,
    query_text: str,
    session_id: str,
    top_k: int = TOP_K,
) -> list[dict[str, Any]]:
    """Store the query transiently and return the top-k place contexts.

    The query document is added with a ``q-<sessionId>-<n>`` id and
    ``{sessionId, ts}`` metadata so :func:`purge_session` can remove it later.
    ``q-*`` documents themselves are excluded from the returned results.
    """
    qid = f"q-{session_id}-0"
    collection.upsert(
        ids=[qid],
        documents=[query_text],
        metadatas=[{"sessionId": session_id, "ts": time.time()}],
    )

    # Fetch a few extra so filtering out the q-* document still yields top_k places.
    results = collection.query(query_texts=[query_text], n_results=top_k + 5)

    places: list[dict[str, Any]] = []
    ids = results.get("ids") or [[]]
    metadatas = results.get("metadatas") or [[]]
    distances = results.get("distances") or [[]]
    for idx, doc_id in enumerate(ids[0]):
        if doc_id.startswith("q-"):
            continue
        meta = metadatas[0][idx] if idx < len(metadatas[0]) else {}
        distance = distances[0][idx] if idx < len(distances[0]) else None
        places.append(
            {
                "id": doc_id,
                "name": (meta or {}).get("name", ""),
                "category": (meta or {}).get("category", ""),
                "rating": (meta or {}).get("rating"),
                "cost": (meta or {}).get("cost"),
                "distance": distance,
            }
        )
        if len(places) >= top_k:
            break

    return places


def purge_session(collection: chromadb.Collection, session_id: str) -> list[str]:
    """Delete all transient ``q-*`` documents for a session. Returns their ids."""
    try:
        found = collection.get(where={"sessionId": session_id})
    except Exception:
        return []
    ids = found.get("ids") or []
    if ids:
        collection.delete(ids=ids)
    return ids


def get_user_interests_collection(
    client: chromadb.PersistentClient | None = None,
) -> chromadb.Collection:
    """Return (creating if needed) the cosine ``user-interests`` collection."""
    client = client or get_client()
    try:
        existing = client.get_collection(name=INTERESTS_COLLECTION)
    except Exception:
        existing = None
    if existing is not None and _is_cosine(existing):
        return existing
    if existing is not None:
        client.delete_collection(INTERESTS_COLLECTION)
    return client.create_collection(
        name=INTERESTS_COLLECTION,
        metadata={"hnsw:space": INTERESTS_SPACE},
    )


def sync_user_interests(
    user_id: str,
    terms: list[str],
    client: chromadb.PersistentClient | None = None,
) -> dict[str, int]:
    """Idempotently reconcile a user's terms with the Chroma collection.

    Missing terms are upserted with their stable ``ui-*`` id; terms no longer
    present in ``terms`` are deleted. Documents are keyed by ``user_id``
    metadata, so other users and the transient ``q-*`` documents are untouched.

    Returns ``{"synced": n, "deleted": n}`` where ``synced`` counts newly
    inserted terms (an idempotent re-sync returns 0/0).
    """
    user = (user_id or "").strip()
    if not user:
        raise ValueError("userId required")

    normalized = normalize_terms(terms)
    collection = get_user_interests_collection(client)

    found = collection.get(where={"user_id": user}, include=[])
    existing_ids = set(found.get("ids") or [])

    desired = {interest_id(user, term): term for term in normalized}
    missing = {doc_id: term for doc_id, term in desired.items() if doc_id not in existing_ids}
    stale = [doc_id for doc_id in existing_ids if doc_id not in desired and doc_id.startswith("ui-")]

    if missing:
        collection.upsert(
            ids=list(missing.keys()),
            documents=list(missing.values()),
            metadatas=[{"user_id": user, "term": term} for term in missing.values()],
        )
    if stale:
        collection.delete(ids=stale)

    return {"synced": len(missing), "deleted": len(stale)}


def get_user_interest_entries(
    user_id: str,
    client: chromadb.PersistentClient | None = None,
    collection: chromadb.Collection | None = None,
) -> list[dict[str, Any]]:
    """Return ``[{id, term, embedding}]`` for a user, ordered by term."""
    collection = collection or get_user_interests_collection(client)
    found = collection.get(
        where={"user_id": user_id},
        include=["documents", "metadatas", "embeddings"],
    )
    ids = found.get("ids") or []
    documents = found.get("documents") or []
    metadatas = found.get("metadatas") or []
    embeddings = found.get("embeddings")

    entries: list[dict[str, Any]] = []
    for idx, doc_id in enumerate(ids):
        meta = metadatas[idx] if idx < len(metadatas) and metadatas[idx] else {}
        term = (meta or {}).get("term")
        if not term and idx < len(documents) and documents[idx]:
            term = str(documents[idx])
        embedding = embeddings[idx] if embeddings is not None and idx < len(embeddings) else None
        entries.append({"id": doc_id, "term": term or "", "embedding": embedding})

    entries.sort(key=lambda entry: entry["term"])
    return entries


def get_user_interest_terms(
    user_id: str,
    client: chromadb.PersistentClient | None = None,
) -> list[str]:
    """Return a user's interest terms (alphabetical, deterministic)."""
    return [entry["term"] for entry in get_user_interest_entries(user_id, client) if entry["term"]]


def user_interest_vector(
    user_id: str,
    client: chromadb.PersistentClient | None = None,
    collection: chromadb.Collection | None = None,
) -> Any | None:
    """Mean-pooled, L2-normalized vector of the user's interests (or ``None``)."""
    entries = get_user_interest_entries(user_id, client, collection)
    return mean_vector(entry["embedding"] for entry in entries if entry["embedding"] is not None)


def query_places_by_vector(
    collection: chromadb.Collection,
    vector: Any,
    n_results: int,
) -> list[dict[str, Any]]:
    """Query a destination collection with a raw embedding.

    Returns ``[{id, metadata, distance}]`` sorted by Chroma (best first), with
    transient ``q-*`` documents filtered out.
    """
    if n_results <= 0:
        return []
    results = collection.query(
        query_embeddings=[list(vector)],
        n_results=n_results,
        include=["documents", "metadatas", "distances"],
    )
    ids = (results.get("ids") or [[]])[0]
    metadatas = (results.get("metadatas") or [[]])[0]
    distances = (results.get("distances") or [[]])[0]

    places: list[dict[str, Any]] = []
    for idx, doc_id in enumerate(ids):
        if doc_id.startswith("q-"):
            continue
        places.append(
            {
                "id": doc_id,
                "metadata": metadatas[idx] if idx < len(metadatas) else {},
                "distance": distances[idx] if idx < len(distances) else None,
            }
        )
    return places


def interest_boost_places(
    collection: chromadb.Collection,
    terms: list[str],
    per_term: int = 3,
    max_terms: int = 5,
) -> list[dict[str, Any]]:
    """Top ``per_term`` places per interest (max ``max_terms``), de-duplicated.

    Used to seed the conversational suggestion prompt with places matching the
    user's declared interests. Shape matches :func:`embed_query` results.
    """
    boost: list[dict[str, Any]] = []
    seen: set[str] = set()
    for term in normalize_terms(terms)[:max_terms]:
        results = collection.query(
            query_texts=[term],
            n_results=per_term + 5,
            include=["documents", "metadatas", "distances"],
        )
        ids = (results.get("ids") or [[]])[0]
        metadatas = (results.get("metadatas") or [[]])[0]
        distances = (results.get("distances") or [[]])[0]
        added = 0
        for idx, doc_id in enumerate(ids):
            if doc_id.startswith("q-") or doc_id in seen:
                continue
            meta = metadatas[idx] if idx < len(metadatas) else {}
            meta = meta or {}
            boost.append(
                {
                    "id": doc_id,
                    "name": meta.get("name", ""),
                    "category": meta.get("category", ""),
                    "rating": meta.get("rating"),
                    "cost": meta.get("cost"),
                    "distance": distances[idx] if idx < len(distances) else None,
                }
            )
            seen.add(doc_id)
            added += 1
            if added >= per_term:
                break
    return boost


def new_session_id() -> str:
    return uuid.uuid4().hex
