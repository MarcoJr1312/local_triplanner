"""Agno tools for the suggestions agent (M3).

Two read-only tools let the agent consult the real backend instead of
inventing places:

- ``search_places`` → ``POST /internal/search-places`` (capped to 10 results).
- ``get_place_details`` → ``POST /internal/place-details`` (reduced dict).

The vector search is intentionally NOT a tool: top-k Chroma results are injected
into the system prompt before the run.
"""

from __future__ import annotations

from typing import Any

from agno.tools import tool

from tripsuggest.backend import BackendClient, BackendError

MAX_SEARCH_RESULTS = 10


def _error_result(code: str, message: str) -> dict[str, Any]:
    return {"error": code, "message": message}


def make_tools(client: BackendClient, trip_id: str, user_id: str) -> list[Any]:
    """Build the agent's tools, closing over the request's trip/user context."""

    @tool(
        name="search_places",
        description="Busca lugares reales del destino del viaje (categoria: restaurantes, "
        "actividades, nightlife, etc.). Devuelve id, nombre, categoria, rating, cost y "
        "direccion. Usala cuando necesites lugares concretos o precios reales.",
    )
    def search_places(query: str) -> dict[str, Any]:
        try:
            places = client.search_places(query=query, trip_id=trip_id, user_id=user_id)
        except BackendError as exc:
            return _error_result(exc.code, exc.message)
        return {"places": places[:MAX_SEARCH_RESULTS]}

    @tool(
        name="get_place_details",
        description="Obtiene el detalle real de un lugar por su id (descripcion, rating, "
        "telefono, web, direccion, horarios, fotos). Usala para confirmar informacion "
        "antes de recomendar un lugar concreto.",
    )
    def get_place_details(placeId: str) -> dict[str, Any]:
        try:
            return client.get_place_details(placeId)
        except BackendError as exc:
            return _error_result(exc.code, exc.message)

    return [search_places, get_place_details]
