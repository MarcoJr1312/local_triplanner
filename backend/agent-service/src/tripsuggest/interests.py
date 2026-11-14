"""Pure helpers for user interests (M2).

No Chroma/network access here so the logic is trivial to unit-test:

- term normalization (strip, lowercase, de-duplicate, keep first occurrence),
- stable document ids ``ui-<userId>-<sha1(term)[:12]>``,
- mean pooling + L2 normalization of interest embeddings,
- cosine distance → integer score (0..100).
"""

from __future__ import annotations

import hashlib
from typing import Any, Iterable

import numpy as np


def normalize_terms(terms: Iterable[Any]) -> list[str]:
    """Strip, lowercase and de-duplicate terms, preserving first occurrence."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in terms:
        if not isinstance(raw, str):
            continue
        term = raw.strip().lower()
        if not term or term in seen:
            continue
        seen.add(term)
        out.append(term)
    return out


def interest_id(user_id: str, term: str) -> str:
    """Stable Chroma id for a user's interest term."""
    digest = hashlib.sha1(term.strip().lower().encode("utf-8")).hexdigest()[:12]
    return f"ui-{user_id}-{digest}"


def mean_vector(embeddings: Iterable[Iterable[float]]) -> np.ndarray | None:
    """Mean-pool embeddings and L2-normalize; ``None`` when there is no vector."""
    rows = [np.asarray(embedding, dtype=np.float64) for embedding in embeddings]
    rows = [row for row in rows if row.size > 0]
    if not rows:
        return None
    mean = np.mean(np.vstack(rows), axis=0)
    norm = float(np.linalg.norm(mean))
    if norm == 0.0:
        return None
    return mean / norm


def score_from_distance(distance: Any) -> int:
    """Cosine similarity → integer percentage, clamped to 0..100.

    Chroma's cosine space reports ``distance = 1 - cosine_similarity``.
    """
    try:
        similarity = 1.0 - float(distance)
    except (TypeError, ValueError):
        similarity = 0.0
    return max(0, min(100, int(round(similarity * 100))))
