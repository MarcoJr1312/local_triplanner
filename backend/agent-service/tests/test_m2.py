"""M2 tests on the pgvector index (no Chroma persistence).

Run without pytest (not a dependency):

    cd backend/agent-service && uv run python tests/test_m2.py

The suite creates/uses ``triplanner_agent_test`` and a deterministic fake
embedder, so it never downloads the ONNX model or touches dev data.
"""

from __future__ import annotations

import hashlib
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Callable, Sequence

import numpy as np
import psycopg

ADMIN_URL = os.environ.get(
    "AGENT_TEST_ADMIN_URL",
    "postgres://triplanner:triplanner@127.0.0.1:5432/triplanner",
)
TEST_DB = "triplanner_agent_test"
TEST_URL = os.environ.get(
    "AGENT_TEST_DATABASE_URL",
    f"postgres://triplanner:triplanner@127.0.0.1:5432/{TEST_DB}",
)


def _ensure_database() -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        found = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB,)).fetchone()
        if not found:
            conn.execute(f"CREATE DATABASE {TEST_DB}")


_ensure_database()
os.environ["DATABASE_URL"] = TEST_URL

from tripsuggest.agent import build_system_prompt  # noqa: E402
from tripsuggest.auto_suggest import NoInterestsError, build_auto_suggest  # noqa: E402
from tripsuggest.enrichment import best_score, should_enrich  # noqa: E402
from tripsuggest.interests import interest_id, mean_vector, normalize_terms  # noqa: E402
from tripsuggest.vector_store import (  # noqa: E402
    DestinationIndex,
    apply_snapshot,
    count_places,
    delete_location,
    embed_query,
    ensure_indexed,
    ensure_schema,
    get_pool,
    get_sync_state,
    get_user_interest_entries,
    get_user_interest_terms,
    interest_boost_places,
    purge_session,
    reset_pool,
    set_embedder_for_tests,
    sync_user_interests,
    upsert_locations,
    user_interest_vector,
)

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "db" / "pg" / "schema.sql"


def _fake_embedder(texts: Sequence[str]) -> list[list[float]]:
    vectors: list[list[float]] = []
    for text in texts:
        seed = int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")
        vector = np.random.default_rng(seed).standard_normal(384)
        norm = float(np.linalg.norm(vector))
        vectors.append((vector / norm if norm else vector).tolist())
    return vectors


def _apply_schema() -> None:
    ensure_schema()


def _reset() -> None:
    with get_pool().connection() as conn:
        conn.execute("DELETE FROM agent_embeddings")
        conn.execute("DELETE FROM agent_sync_state")


def _seed_places(count: int = 15) -> list[dict[str, Any]]:
    categories = ["food", "sight", "activity", "nightlife"]
    places: list[dict[str, Any]] = []
    for idx in range(count):
        places.append(
            {
                "id": f"place-{idx:02d}",
                "name": f"Playa Surf {idx}" if idx % 3 == 0 else f"Museo {idx}",
                "category": categories[idx % len(categories)],
                "description": (
                    f"Playa con olas para surf y ambiente relajado numero {idx}"
                    if idx % 3 == 0
                    else f"Museo de arte e historia numero {idx}"
                ),
                "tags": ["playa", "surf"] if idx % 3 == 0 else ["museo", "arte"],
                "rating": 4.0 + (idx % 5) / 10,
                "cost": idx * 3.5,
            }
        )
    return places


def _count_places(destination_id: str) -> int:
    with get_pool().connection() as conn:
        row = conn.execute(
            "SELECT count(*) FROM agent_embeddings WHERE destination_id = %s AND kind = 'place'",
            (destination_id,),
        ).fetchone()
    return int(row[0]) if row else 0


def test_normalize_terms() -> None:
    assert normalize_terms([" Food ", "food", "MUSEUMS", "", "  ", "museums", 42]) == [
        "food",
        "museums",
    ]


def test_sync_diff_is_idempotent_and_ids_are_stable() -> None:
    _reset()
    first = sync_user_interests("u1", [" Food ", "MUSEUMS", "food"])
    assert first == {"synced": 2, "deleted": 0}, first

    entries = get_user_interest_entries("u1")
    assert [e["term"] for e in entries] == ["food", "museums"]
    assert {e["id"] for e in entries} == {
        interest_id("u1", "food"),
        interest_id("u1", "museums"),
    }

    with get_pool().connection() as conn:
        row = conn.execute(
            "SELECT metadata FROM agent_embeddings WHERE id = %s",
            (interest_id("u1", "food"),),
        ).fetchone()
    assert row is not None
    assert row[0]["user_id"] == "u1"
    assert row[0]["term"] == "food"

    # Another user's rows must never be touched.
    sync_user_interests("u2", ["food"])

    second = sync_user_interests("u1", ["museums"])
    assert second == {"synced": 0, "deleted": 1}, second
    assert get_user_interest_terms("u1") == ["museums"]
    assert get_user_interest_terms("u2") == ["food"]

    third = sync_user_interests("u1", ["MUSEUMS"])
    assert third == {"synced": 0, "deleted": 0}, third

    fourth = sync_user_interests("u1", ["museums", "surf"])
    assert fourth == {"synced": 1, "deleted": 0}, fourth
    ids = {e["term"]: e["id"] for e in get_user_interest_entries("u1")}
    assert ids["museums"] == interest_id("u1", "museums")
    assert ids["surf"] == interest_id("u1", "surf")


def test_mean_pooling_produces_unit_vector() -> None:
    _reset()
    sync_user_interests("u1", ["playa", "surf", "museos"])
    vector = user_interest_vector("u1")
    assert vector is not None
    assert abs(float(np.linalg.norm(vector)) - 1.0) < 1e-9

    entries = get_user_interest_entries("u1")
    dims = {len(e["embedding"]) for e in entries if e["embedding"] is not None}
    assert len(dims) == 1
    assert mean_vector([e["embedding"] for e in entries]).shape == (dims.pop(),)


def test_purge_q_rows_does_not_touch_interests_or_places() -> None:
    _reset()
    index = ensure_indexed("dest1", _seed_places(3), "hash-1")
    sync_user_interests("u1", ["playa", "surf"])

    places = embed_query(index, "playa con olas", "sess-1", top_k=2)
    assert len(places) == 2
    assert all(not p["id"].startswith("q-") for p in places)

    with get_pool().connection() as conn:
        qid = conn.execute(
            "SELECT id FROM agent_embeddings WHERE kind = 'query' AND session_id = 'sess-1'"
        ).fetchone()
    assert qid == ("q-sess-1-0",)

    purged = purge_session(index, "sess-1")
    assert purged == ["q-sess-1-0"]
    assert _count_places("dest1") == 3
    assert get_user_interest_terms("u1") == ["playa", "surf"]


def test_auto_suggest_pages_scores_and_has_more() -> None:
    _reset()
    destination = ensure_indexed("dest1", _seed_places(15), "hash-15")
    sync_user_interests("u1", ["playa", "surf", "museo"])

    first = build_auto_suggest("u1", destination.destination_id, 0, 10)
    assert len(first["items"]) == 10, first
    assert first["hasMore"] is True
    scores = [item["score"] for item in first["items"]]
    assert scores == sorted(scores, reverse=True)
    assert all(isinstance(score, int) and 0 <= score <= 100 for score in scores)
    assert all(set(item) == {"placeId", "title", "category", "cost", "score"} for item in first["items"])

    second = build_auto_suggest("u1", destination.destination_id, 10, 5)
    assert len(second["items"]) == 5
    assert second["hasMore"] is False
    assert second["items"][0]["score"] <= first["items"][-1]["score"]

    first_ids = {item["placeId"] for item in first["items"]}
    second_ids = {item["placeId"] for item in second["items"]}
    assert not (first_ids & second_ids)
    assert len(first_ids | second_ids) == 15

    beyond = build_auto_suggest("u1", destination.destination_id, 15, 5)
    assert beyond == {"items": [], "hasMore": False, "offset": 15}


def test_auto_suggest_without_interests_raises() -> None:
    _reset()
    destination = ensure_indexed("dest1", _seed_places(3), "hash-3")
    try:
        build_auto_suggest("nobody", destination.destination_id, 0, 10)
    except NoInterestsError:
        pass
    else:  # pragma: no cover - explicit failure path
        raise AssertionError("NoInterestsError was not raised")


def test_interest_boost_dedupes_and_caps() -> None:
    _reset()
    destination = ensure_indexed("dest1", _seed_places(15), "hash-15")
    boost = interest_boost_places(destination, ["playa", "surf"], per_term=3, max_terms=5)
    ids = [p["id"] for p in boost]
    assert len(ids) == len(set(ids))
    assert 1 <= len(ids) <= 6
    assert all(not p["id"].startswith("q-") for p in boost)


def test_suggestions_prompt_includes_interests() -> None:
    prompt = build_system_prompt({"trip": {}}, [], "es", ["playa", "surf"])
    assert "INTERESES DEL USUARIO" in prompt
    assert "playa, surf" in prompt
    assert "INTERESES DEL USUARIO" not in build_system_prompt({"trip": {}}, [], "es", [])


def test_reindex_only_when_hash_changes() -> None:
    _reset()
    ensure_indexed("dest1", _seed_places(3), "hash-3")
    assert _count_places("dest1") == 3

    # Same hash: no re-index.
    ensure_indexed("dest1", _seed_places(3), "hash-3")
    assert _count_places("dest1") == 3

    # New hash: replaces the destination's place rows.
    ensure_indexed("dest1", _seed_places(5), "hash-5")
    assert _count_places("dest1") == 5


def test_destination_index_shape() -> None:
    _reset()
    index = ensure_indexed("dest1", _seed_places(3), "hash-3")
    assert isinstance(index, DestinationIndex)
    assert index.destination_id == "dest1"
    assert index.content_hash == "hash-3"


def test_snapshot_sync_versions_and_tombstones() -> None:
    _reset()
    places = _seed_places(3)
    for place in places:
        place["version"] = 1
    apply_snapshot(places)
    assert count_places() == 3
    assert get_sync_state("bootstrap_complete") == "true"

    # One update, one drop.
    places[0]["version"] = 2
    places[0]["name"] = "Updated place"
    apply_snapshot(places[:2])
    assert count_places() == 2

    # A stale copy of the dropped row must not resurrect it.
    stale = dict(places[2])
    stale["version"] = 1
    upsert_locations([stale])
    assert count_places() == 2

    # Delete tombstones; stale upserts are ignored, newer versions resurrect.
    delete_location(places[0]["id"], 3)
    assert count_places() == 1
    upsert_locations([{**places[0], "version": 2}])
    assert count_places() == 1
    upsert_locations([{**places[0], "version": 4, "name": "Back again"}])
    assert count_places() == 2


def test_weak_match_enrichment_threshold() -> None:
    assert best_score([]) == 0
    assert should_enrich([], 5) is True
    strong = [{"distance": 0.1} for _ in range(5)]
    assert best_score(strong) == 90
    assert should_enrich(strong, 5) is False
    weak = [{"distance": 0.8} for _ in range(5)]
    assert should_enrich(weak, 5) is True


def test_clearing_interests_removes_all_terms() -> None:
    _reset()
    set_embedder_for_tests(_fake_embedder)
    sync_user_interests("u-empty", ["food", "museums"])
    assert get_user_interest_terms("u-empty") == ["food", "museums"]
    sync_user_interests("u-empty", [])
    assert get_user_interest_terms("u-empty") == []
    set_embedder_for_tests(None)


def test_demo_mode_returns_actionable_blocks() -> None:
    from tripsuggest.settings import get_settings

    os.environ["LLM_PROVIDER"] = "none"
    os.environ.pop("LLM_API_KEY", None)
    get_settings.cache_clear()

    from tripsuggest.agent import _demo_day_plan_answer, _demo_suggestions_answer
    from tripsuggest.plan import parse_plan_block
    from tripsuggest.provider import effective_model_name, is_demo_provider, make_model

    assert is_demo_provider() is True
    assert make_model() is None
    assert effective_model_name() == ""

    context = {
        "trip": {"destinationName": "Toronto"},
        "days": [{"items": [{"locationId": "tor-1", "title": "CN Tower", "category": "sight", "cost": 43}]}],
    }
    vector = [{"id": "tor-2", "name": "ROM", "category": "sight", "cost": 26, "rating": 4.7}]

    answer = _demo_suggestions_answer(context, vector, "es", ["museos"])
    assert "```suggestions" in answer
    assert '"placeId": "tor-2"' in answer

    plan_answer = _demo_day_plan_answer(context, vector, "es")
    plan = parse_plan_block(plan_answer)
    assert len(plan) == 2
    assert plan[0]["startTime"] == "09:00"
    assert {entry["placeId"] for entry in plan} == {"tor-1", "tor-2"}

    get_settings.cache_clear()


TESTS: list[Callable[[], None]] = [
    test_normalize_terms,
    test_sync_diff_is_idempotent_and_ids_are_stable,
    test_mean_pooling_produces_unit_vector,
    test_purge_q_rows_does_not_touch_interests_or_places,
    test_auto_suggest_pages_scores_and_has_more,
    test_auto_suggest_without_interests_raises,
    test_interest_boost_dedupes_and_caps,
    test_suggestions_prompt_includes_interests,
    test_reindex_only_when_hash_changes,
    test_destination_index_shape,
    test_snapshot_sync_versions_and_tombstones,
    test_weak_match_enrichment_threshold,
    test_clearing_interests_removes_all_terms,
    test_demo_mode_returns_actionable_blocks,
]


def main() -> int:
    _apply_schema()
    set_embedder_for_tests(_fake_embedder)
    failures = 0
    for test in TESTS:
        try:
            test()
        except Exception:
            failures += 1
            print(f"FAIL {test.__name__}")
            traceback.print_exc()
        else:
            print(f"PASS {test.__name__}")
    reset_pool()
    print(f"\n{len(TESTS) - failures}/{len(TESTS)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
