"""M2 tests: user-interests collection, sync diff, pooling and auto-suggest.

Run without pytest (not a dependency):

    cd local/agent-service && uv run python tests/test_m2.py

Every test uses its own temporary Chroma directory, never ``data/chroma``.
"""

from __future__ import annotations

import sys
import tempfile
import traceback
from typing import Any, Callable

import numpy as np

from tripsuggest.auto_suggest import build_auto_suggest, NoInterestsError
from tripsuggest.chroma_store import (
    embed_query,
    ensure_indexed,
    get_client,
    get_user_interest_entries,
    get_user_interest_terms,
    get_user_interests_collection,
    interest_boost_places,
    purge_session,
    sync_user_interests,
    user_interest_vector,
)
from tripsuggest.interests import interest_id, mean_vector, normalize_terms


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


def test_normalize_terms() -> None:
    assert normalize_terms([" Food ", "food", "MUSEUMS", "", "  ", "museums", 42]) == [
        "food",
        "museums",
    ]


def test_sync_diff_is_idempotent_and_ids_are_stable() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        client = get_client(tmp)

        first = sync_user_interests("u1", [" Food ", "MUSEUMS", "food"], client=client)
        assert first == {"synced": 2, "deleted": 0}, first

        entries = get_user_interest_entries("u1", client=client)
        assert [e["term"] for e in entries] == ["food", "museums"]
        assert {e["id"] for e in entries} == {
            interest_id("u1", "food"),
            interest_id("u1", "museums"),
        }
        collection = get_user_interests_collection(client)
        raw = collection.get(ids=[interest_id("u1", "food")])
        assert raw["metadatas"][0]["user_id"] == "u1"
        assert raw["metadatas"][0]["term"] == "food"

        # Another user's docs must never be touched.
        sync_user_interests("u2", ["food"], client=client)

        second = sync_user_interests("u1", ["museums"], client=client)
        assert second == {"synced": 0, "deleted": 1}, second
        assert get_user_interest_terms("u1", client) == ["museums"]
        assert get_user_interest_terms("u2", client) == ["food"]

        # Idempotent re-sync: nothing to add, nothing to delete.
        third = sync_user_interests("u1", ["MUSEUMS"], client=client)
        assert third == {"synced": 0, "deleted": 0}, third

        # Adding a term keeps the existing stable id.
        fourth = sync_user_interests("u1", ["museums", "surf"], client=client)
        assert fourth == {"synced": 1, "deleted": 0}, fourth
        ids = {e["term"]: e["id"] for e in get_user_interest_entries("u1", client)}
        assert ids["museums"] == interest_id("u1", "museums")
        assert ids["surf"] == interest_id("u1", "surf")


def test_mean_pooling_produces_unit_vector() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        client = get_client(tmp)
        sync_user_interests("u1", ["playa", "surf", "museos"], client=client)
        vector = user_interest_vector("u1", client=client)
        assert vector is not None
        assert abs(float(np.linalg.norm(vector)) - 1.0) < 1e-9

        entries = get_user_interest_entries("u1", client=client)
        dims = {len(e["embedding"]) for e in entries}
        assert len(dims) == 1
        assert mean_vector([e["embedding"] for e in entries]).shape == (dims.pop(),)


def test_purge_q_documents_does_not_touch_interests_or_places() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        client = get_client(tmp)
        collection = ensure_indexed("dest1", _seed_places(3), "hash-1", client=client)
        sync_user_interests("u1", ["playa", "surf"], client=client)

        places = embed_query(collection, "playa con olas", "sess-1", top_k=2)
        assert len(places) == 2
        assert all(not p["id"].startswith("q-") for p in places)
        assert collection.get(ids=["q-sess-1-0"])["ids"] == ["q-sess-1-0"]

        purged = purge_session(collection, "sess-1")
        assert purged == ["q-sess-1-0"]
        assert collection.get(ids=["q-sess-1-0"])["ids"] == []

        # Place docs remain indexed.
        assert collection.count() == 3
        # Interests live in another collection and are untouched.
        assert get_user_interest_terms("u1", client) == ["playa", "surf"]


def test_auto_suggest_pages_scores_and_has_more() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        client = get_client(tmp)
        destination = ensure_indexed("dest1", _seed_places(15), "hash-15", client=client)
        interests = get_user_interests_collection(client)
        sync_user_interests("u1", ["playa", "surf", "museo"], client=client)

        first = build_auto_suggest("u1", destination, 0, 10, interests)
        assert len(first["items"]) == 10, first
        assert first["hasMore"] is True
        assert first["offset"] == 0
        scores = [item["score"] for item in first["items"]]
        assert scores == sorted(scores, reverse=True)
        assert all(isinstance(score, int) and 0 <= score <= 100 for score in scores)
        assert all(
            set(item) == {"placeId", "title", "category", "cost", "score"}
            for item in first["items"]
        )

        second = build_auto_suggest("u1", destination, 10, 5, interests)
        assert len(second["items"]) == 5, second
        assert second["hasMore"] is False
        assert second["offset"] == 10
        second_scores = [item["score"] for item in second["items"]]
        assert second_scores == sorted(second_scores, reverse=True)

        first_ids = {item["placeId"] for item in first["items"]}
        second_ids = {item["placeId"] for item in second["items"]}
        assert not (first_ids & second_ids)
        assert len(first_ids | second_ids) == 15

        beyond = build_auto_suggest("u1", destination, 15, 5, interests)
        assert beyond == {"items": [], "hasMore": False, "offset": 15}


def test_auto_suggest_without_interests_raises() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        client = get_client(tmp)
        destination = ensure_indexed("dest1", _seed_places(3), "hash-3", client=client)
        interests = get_user_interests_collection(client)
        try:
            build_auto_suggest("nobody", destination, 0, 10, interests)
        except NoInterestsError:
            pass
        else:  # pragma: no cover - explicit failure path
            raise AssertionError("NoInterestsError was not raised")


def test_interest_boost_dedupes_and_caps() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        client = get_client(tmp)
        destination = ensure_indexed("dest1", _seed_places(15), "hash-15", client=client)
        boost = interest_boost_places(destination, ["playa", "surf"], per_term=3, max_terms=5)
        ids = [p["id"] for p in boost]
        assert len(ids) == len(set(ids))
        assert 1 <= len(ids) <= 6
        assert all(not p["id"].startswith("q-") for p in boost)


def test_suggestions_prompt_includes_interests() -> None:
    from tripsuggest.agent import build_system_prompt

    prompt = build_system_prompt({"trip": {}}, [], "es", ["playa", "surf"])
    assert "INTERESES DEL USUARIO" in prompt
    assert "playa, surf" in prompt
    assert "INTERESES DEL USUARIO" not in build_system_prompt({"trip": {}}, [], "es", [])


def test_destination_collections_use_cosine_space() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        client = get_client(tmp)
        collection = ensure_indexed("dest1", _seed_places(3), "hash-3", client=client)
        interests = get_user_interests_collection(client)
        assert collection.metadata.get("hnsw:space") == "cosine"
        assert interests.metadata.get("hnsw:space") == "cosine"


TESTS: list[Callable[[], None]] = [
    test_normalize_terms,
    test_sync_diff_is_idempotent_and_ids_are_stable,
    test_mean_pooling_produces_unit_vector,
    test_purge_q_documents_does_not_touch_interests_or_places,
    test_auto_suggest_pages_scores_and_has_more,
    test_auto_suggest_without_interests_raises,
    test_interest_boost_dedupes_and_caps,
    test_suggestions_prompt_includes_interests,
    test_destination_collections_use_cosine_space,
]


def main() -> int:
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
    print(f"\n{len(TESTS) - failures}/{len(TESTS)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
