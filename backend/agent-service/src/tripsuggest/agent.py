"""Agent assembly for the suggestions endpoint (M3).

Builds the Agno agent with the full trip context (system prompt), the two
read-only tools, and runs it over the conversation history. The vector search
results are injected into the system prompt *before* the run — they are not a
tool.
"""

from __future__ import annotations

import json
from typing import Any

from agno.agent import Agent
from agno.models.message import Message

from tripsuggest.provider import make_model
from tripsuggest.tools import make_tools

_SEARCH_RADIUS_KM = 75


def _fmt_money(value: Any) -> str:
    if value is None:
        return "n/d"
    try:
        return f"{float(value):,.2f}"
    except (TypeError, ValueError):
        return str(value)


def _render_context(context: dict[str, Any]) -> str:
    trip = context.get("trip") or {}
    days = context.get("days") or []
    members = context.get("members") or []

    lines: list[str] = []
    lines.append(f"Viaje: {trip.get('name') or 'Sin nombre'}")
    lines.append(
        f"Destino: {trip.get('destinationName') or 'n/d'} "
        f"(lat {trip.get('lat')}, lng {trip.get('lng')})"
    )
    lines.append(f"Fechas: {trip.get('startDate') or '?'} → {trip.get('endDate') or '?'}")
    lines.append(
        f"Presupuesto: total {_fmt_money(trip.get('totalBudget'))} / "
        f"gastado {_fmt_money(trip.get('spent'))}"
    )

    lines.append("Actividades por día:")
    for day in days:
        date = day.get("date") or "sin fecha"
        items = day.get("items") or []
        if not items:
            continue
        lines.append(f"- {date}:")
        for item in items:
            start = item.get("startTime")
            time_part = f" a las {start}" if start else ""
            lines.append(
                f"    * {item.get('title') or 'sin título'} "
                f"[{item.get('category') or 'activity'}] {_fmt_money(item.get('cost'))}{time_part}"
            )

    if members:
        member_names = ", ".join(m.get("displayName") or m.get("userId") for m in members)
        lines.append(f"Viajeros: {member_names}")

    lines.append(f"Idioma del usuario: {context.get('userLanguage') or 'es'}")
    return "\n".join(lines)


def _render_vector_context(places: list[dict[str, Any]]) -> str:
    if not places:
        return "(sin resultados de búsqueda vectorial)"
    lines: list[str] = []
    for p in places:
        bits = [p.get("name") or "?", p.get("category") or ""]
        if p.get("rating") not in (None, 0.0, 0):
            bits.append(f"rating {p.get('rating')}")
        if p.get("cost") not in (None, 0.0, 0):
            bits.append(f"cost {_fmt_money(p.get('cost'))}")
        lines.append("- " + ", ".join(b for b in bits if b))
    return "\n".join(lines)


def _common_header(context: dict[str, Any], vector_places: list[dict[str, Any]]) -> str:
    return (
        "Eres el asistente de viajes de Triplanner, una app colaborativa de planificación de viajes.\n\n"
        "CONTEXTO DEL VIAJE:\n"
        f"{_render_context(context)}\n\n"
        "LUGARES CANDIDATOS (búsqueda semántica sobre el destino):\n"
        f"{_render_vector_context(vector_places)}\n\n"
    )


def build_system_prompt(
    context: dict[str, Any],
    vector_places: list[dict[str, Any]],
    locale: str,
    interests: list[str] | None = None,
) -> str:
    lang = locale if locale in ("es", "en") else "en"
    interests_block = ""
    if interests:
        interests_block = (
            "INTERESES DEL USUARIO (priorízalos al recomendar): "
            f"{', '.join(interests)}\n\n"
        )
    return (
        _common_header(context, vector_places)
        + interests_block
        + "REGLAS:\n"
        f"- Responde SIEMPRE en {lang}.\n"
        f"- Sugiere SOLO lugares del destino actual (radio ~{_SEARCH_RADIUS_KM} km).\n"
        "- Usa las tools search_places y get_place_details para obtener información real; "
        "nunca inventes lugares ni precios.\n"
        "- Da una lista clara y corta: nombre del lugar, por qué encaja, y precio estimado si lo hay.\n"
        "- Sin emojis.\n"
        "- No repitas información que ya esté en el plan del viaje; propón opciones nuevas.\n"
        "- Al final de tu respuesta, SIEMPRE que hayas recomendado lugares concretos, incluye un bloque JSON "
        "delimitado por ```suggestions (al abrir) y ``` (al cerrar) con un ARRAY de objetos. Formato exacto "
        "de cada objeto: {\"placeId\": \"<id real>\", \"title\": \"<nombre>\", \"category\": \"<categoria>\", "
        "\"cost\": <numero o null>}.\n"
        "- placeId DEBE ser el id real del lugar (el campo id que devuelven search_places/get_place_details o "
        "la búsqueda vectorial); NUNCA inventes ids.\n"
        "- category: usa una de food | activity | sight | nightlife (si no encaja, usa 'activity').\n"
        "- cost: el precio estimado como número si lo conoces; si no, null.\n"
        "- Incluye SOLO los lugares que efectivamente recomendaste; si no recomiendas ninguno, OMITE el bloque.\n"
        "- El bloque va al FINAL de la respuesta, después del texto visible; NO lo menciones ni lo anuncies en el texto visible.\n"
        "- Formato exacto del bloque (OBLIGATORIO):\n"
        "```suggestions\n"
        "[{\"placeId\": \"id-real-del-lugar\", \"title\": \"Nombre del lugar\", \"category\": \"food\", \"cost\": 25}]\n"
        "```"
    )


def build_day_plan_prompt(context: dict[str, Any], vector_places: list[dict[str, Any]], locale: str) -> str:
    lang = locale if locale in ("es", "en") else "en"
    return (
        _common_header(context, vector_places)
        + "TAREA:\n"
        "Planifica UN día completo (un día genérico del viaje) en el destino actual, combinando "
        "comidas y actividades en orden cronológico.\n"
        "- Comidas: desayuno ~08:00-09:30, almuerzo ~12:30-14:00, cena ~19:00-21:00.\n"
        "- Actividades por la mañana y por la tarde entre las comidas.\n"
        "- Entre 4 y 8 entradas en total, en orden cronológico.\n\n"
        "REGLAS:\n"
        f"- Responde SIEMPRE en {lang}.\n"
        f"- Usa SOLO lugares reales del destino actual (radio ~{_SEARCH_RADIUS_KM} km).\n"
        "- Usa las tools search_places y get_place_details para obtener lugares reales; "
        "nunca inventes lugares ni precios.\n"
        "- Cada entrada lleva una hora de inicio HH:MM válida entre 07:00 y 23:00.\n"
        "- Sin emojis.\n"
        f"- El texto visible (antes del bloque JSON) es un resumen breve del día en {lang}, de 2 a 4 líneas.\n"
        "- Al final de tu respuesta, SIEMPRE incluye un bloque JSON delimitado por ```plan (al abrir) y "
        "``` (al cerrar) con un ARRAY de objetos, en orden cronológico. Formato exacto de cada objeto: "
        "{\"placeId\": \"<id real>\", \"title\": \"<nombre>\", \"category\": \"<categoria>\", "
        "\"cost\": <numero o null>, \"startTime\": \"HH:MM\"}.\n"
        "- placeId DEBE ser el id real del lugar (el campo id que devuelven search_places/get_place_details o "
        "la búsqueda vectorial); NUNCA inventes ids.\n"
        "- category: usa una de food | activity | sight | nightlife (si no encaja, usa 'activity').\n"
        "- cost: el precio estimado como número si lo conoces; si no, null.\n"
        "- startTime: hora de inicio HH:MM entre 07:00 y 23:00, formateada con dos dígitos (ej: 08:30).\n"
        "- El bloque va al FINAL de la respuesta, después del texto visible; NO lo menciones ni lo anuncies en el texto visible.\n"
        "- Formato exacto del bloque (OBLIGATORIO):\n"
        "```plan\n"
        "[{\"placeId\": \"id-real-del-lugar\", \"title\": \"Nombre del lugar\", \"category\": \"food\", \"cost\": 25, \"startTime\": \"08:30\"}]\n"
        "```"
    )


def _candidate_places(
    context: dict[str, Any],
    vector_places: list[dict[str, Any]],
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Deterministic candidates for demo mode: vector hits first, then itinerary."""
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(
        place_id: Any,
        title: Any,
        category: Any,
        cost: Any,
        rating: Any = None,
    ) -> None:
        pid = str(place_id or "").strip()
        name = str(title or "").strip()
        if not pid or not name or pid in seen:
            return
        seen.add(pid)
        try:
            numeric_cost = float(cost) if cost not in (None, "") else 0.0
        except (TypeError, ValueError):
            numeric_cost = 0.0
        candidates.append(
            {
                "placeId": pid,
                "title": name,
                "category": str(category or "activity"),
                "cost": numeric_cost,
                "rating": rating,
            }
        )

    for place in vector_places or []:
        add(
            place.get("id") or place.get("placeId"),
            place.get("name") or place.get("title"),
            place.get("category"),
            place.get("cost"),
            place.get("rating"),
        )
    for day in context.get("days") or []:
        for item in day.get("items") or []:
            add(
                item.get("locationId") or item.get("placeId") or item.get("id"),
                item.get("title"),
                item.get("category"),
                item.get("cost"),
            )
    return candidates[:limit]


def _demo_suggestions_answer(
    context: dict[str, Any],
    vector_places: list[dict[str, Any]],
    locale: str,
    interests: list[str] | None,
) -> str:
    lang = locale if locale in ("es", "en") else "en"
    destination = (context.get("trip") or {}).get("destinationName") or (
        "el destino" if lang == "es" else "the destination"
    )
    places = _candidate_places(context, vector_places, 4)
    if not places:
        return (
            "Todavía no tengo lugares del catálogo para recomendarte. "
            "Prueba a buscar un lugar o ajusta los intereses del viaje."
            if lang == "es"
            else "I don't have catalogue places to recommend yet. "
            "Try searching for a place or adjusting the trip interests."
        )

    if lang == "es":
        lines = [f"Ideas del catálogo local para {destination}:"]
        if interests:
            lines.append(f"Tus intereses: {', '.join(interests)}.")
    else:
        lines = [f"Ideas from the local catalogue for {destination}:"]
        if interests:
            lines.append(f"Your interests: {', '.join(interests)}.")

    for place in places:
        bits = [place["title"], f"({place['category']})"]
        if place.get("rating") not in (None, 0.0, 0):
            bits.append(f"rating {place['rating']}")
        if place.get("cost"):
            bits.append(f"~{place['cost']:.0f}")
        lines.append("- " + " · ".join(bits))

    lines.append(
        "Puedes añadirlos al día con el botón +."
        if lang == "es"
        else "Use the + button to add them to the day."
    )
    payload = [
        {
            "placeId": place["placeId"],
            "title": place["title"],
            "category": place["category"],
            "cost": place["cost"],
        }
        for place in places
    ]
    block = json.dumps(payload, ensure_ascii=False)
    return "\n".join(lines) + f"\n\n```suggestions\n{block}\n```"


def _demo_day_plan_answer(
    context: dict[str, Any],
    vector_places: list[dict[str, Any]],
    locale: str,
) -> str:
    lang = locale if locale in ("es", "en") else "en"
    destination = (context.get("trip") or {}).get("destinationName") or (
        "el destino" if lang == "es" else "the destination"
    )
    places = _candidate_places(context, vector_places, 5)
    if not places:
        return (
            "Todavía no tengo lugares del catálogo para armar el día."
            if lang == "es"
            else "I don't have catalogue places to build the day yet."
        )

    times = ["09:00", "11:30", "13:30", "16:00", "19:30"]
    entries = [
        {
            "placeId": place["placeId"],
            "title": place["title"],
            "category": place["category"],
            "cost": place["cost"],
            "startTime": times[index] if index < len(times) else None,
        }
        for index, place in enumerate(places)
    ]
    if lang == "es":
        lines = [
            f"Plan de un día en {destination}:",
            "Combina una visita por la mañana, comida, una actividad de tarde y cena.",
        ]
    else:
        lines = [
            f"One-day plan for {destination}:",
            "A morning visit, lunch, an afternoon activity and dinner.",
        ]
    lines.append(
        "Ajusta los horarios a tu ritmo; el catálogo es local y determinista."
        if lang == "es"
        else "Adjust the times to your pace; the catalogue is local and deterministic."
    )
    block = json.dumps(entries, ensure_ascii=False)
    return "\n".join(lines) + f"\n\n```plan\n{block}\n```"


def run_agent(
    *,
    client: Any,
    trip_id: str,
    user_id: str,
    context: dict[str, Any],
    vector_places: list[dict[str, Any]],
    history: list[dict[str, str]],
    locale: str,
    interests: list[str] | None = None,
) -> str:
    """Run the agent over the conversation and return its full answer."""
    model = make_model()
    if model is None:
        return _demo_suggestions_answer(context, vector_places, locale, interests)

    agent = Agent(
        model=model,
        tools=make_tools(client, trip_id, user_id),
        description="Asistente de sugerencias de viaje de Triplanner.",
        instructions=build_system_prompt(context, vector_places, locale, interests),
        markdown=False,
    )

    messages = [
        Message(role=m["role"], content=m["content"])
        for m in history
        if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)
    ]
    if not messages:
        messages = [Message(role="user", content="¿Qué me recomiendas?")]

    result = agent.run(input=messages)
    return (result.content or "").strip()


def run_day_plan_agent(
    *,
    client: Any,
    trip_id: str,
    user_id: str,
    context: dict[str, Any],
    vector_places: list[dict[str, Any]],
    locale: str,
) -> str:
    """Run the agent over a single "plan one day" prompt and return its answer."""
    destination = (context.get("trip") or {}).get("destinationName") or "el destino"
    model = make_model()
    if model is None:
        return _demo_day_plan_answer(context, vector_places, locale)

    agent = Agent(
        model=model,
        tools=make_tools(client, trip_id, user_id),
        description="Planificador de un día de viaje de Triplanner.",
        instructions=build_day_plan_prompt(context, vector_places, locale),
        markdown=False,
    )

    result = agent.run(
        input=[Message(role="user", content=f"Planifica un día completo en {destination}.")]
    )
    return (result.content or "").strip()
