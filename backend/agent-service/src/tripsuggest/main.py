"""FastAPI app for the Triplanner agent service (M3).

Exposes the real suggestions endpoint plus a health check. The endpoint:

1. Resolves the demo identity from ``X-User-Id``.
2. Loads trip context from the backend (membership is enforced server-side).
3. Indexes/refreshes the destination's pgvector index from the places cache
   and injects the top-k matches of the user's latest query into the prompt.
4. Runs the Agno agent (with ``search_places``/``get_place_details`` tools) over
   the conversation and returns the full answer.
5. Persists the chat via ``POST /internal/save-chat`` and purges the transient
   ``q-*`` query documents.
"""

from __future__ import annotations

import asyncio
import hmac
import logging
from typing import Any

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from tripsuggest.agent import run_agent, run_day_plan_agent
from tripsuggest.auth import resolve_demo_user
from tripsuggest.auto_suggest import NoInterestsError, auto_suggest
from tripsuggest.backend import BackendClient, BackendError
from tripsuggest.provider import effective_model_name, is_demo_provider
from tripsuggest.vector_store import (
    embed_query,
    ensure_indexed,
    get_user_interest_terms,
    interest_boost_places,
    new_session_id,
    purge_session,
    sync_user_interests,
)
from tripsuggest.interests import normalize_terms
from tripsuggest.plan import parse_plan_block
from tripsuggest.settings import get_settings, update_override

logger = logging.getLogger("tripsuggest")

app = FastAPI(title="Tripsuggest agent service", version="0.3.0")

AGENT_TIMEOUT_S = 90


class ChatMessageIn(BaseModel):
    role: str
    content: str


class SuggestionsRequest(BaseModel):
    tripId: str
    messages: list[ChatMessageIn]
    locale: str = Field(default="en", pattern="^(es|en)$")
    day: str | None = None


class DayPlanRequest(BaseModel):
    tripId: str
    locale: str = Field(default="en", pattern="^(es|en)$")


class AutoSuggestRequest(BaseModel):
    tripId: str
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=10, ge=1, le=50)


class InterestsSyncRequest(BaseModel):
    userId: str
    terms: list[str] = Field(default_factory=list)


class LlmConfigRequest(BaseModel):
    provider: str
    apiKey: str | None = None
    model: str | None = None
    baseUrl: str | None = None
    clearKey: bool = False


class AgentError(Exception):
    """Raised when the agent run fails (mapped to AGENT_ERROR)."""


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def _authenticate(x_user_id: str | None) -> tuple[str, str | None]:
    """Resolve the caller identity from the demo ``X-User-Id`` header."""
    return resolve_demo_user(x_user_id), None


def _last_user_query(messages: list[ChatMessageIn]) -> str:
    for m in reversed(messages):
        if m.role == "user" and m.content.strip():
            return m.content.strip()
    return messages[-1].content.strip() if messages else ""


def _merge_places(
    primary: list[dict[str, Any]],
    extra: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Union two place lists by id, preserving order and dropping duplicates."""
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for place in [*primary, *extra]:
        doc_id = str(place.get("id") or "")
        if not doc_id or doc_id in seen:
            continue
        seen.add(doc_id)
        merged.append(place)
    return merged


def _user_interest_terms(user_id: str, context: dict[str, Any]) -> list[str]:
    """Interests for the prompt/boost: pgvector first, backend context fallback."""
    try:
        terms = get_user_interest_terms(user_id)
    except Exception:
        logger.exception("failed to load user interests from pgvector")
        terms = []
    if terms:
        return terms
    return normalize_terms(context.get("interests") or [])


def _internal_token_ok(provided: str | None) -> bool:
    expected = get_settings().internal_token
    if not expected or not provided:
        return False
    return hmac.compare_digest(expected, provided)


def _resolve_day(requested: str | None, context: dict[str, Any]) -> str:
    if requested and requested.strip():
        return requested.strip()
    for day in context.get("days") or []:
        if day.get("items"):
            return day.get("date") or ""
    return (context.get("trip") or {}).get("startDate") or ""


def _run_pipeline(
    client: BackendClient,
    body: SuggestionsRequest,
    user_id: str,
    user_email: str | None,
) -> str:
    context = client.get_trip_context(body.tripId, user_id, user_email)
    # El backend resuelve la identidad real (email → users.id); usamos ese id
    # para todo lo demás (membresía, favoritos, guardado del chat).
    resolved_user_id = str(context.get("userId") or user_id)

    interest_terms = _user_interest_terms(resolved_user_id, context)

    cache = client.get_places_cache(body.tripId, resolved_user_id, user_email)
    places = cache.get("places") or []
    content_hash = cache.get("contentHash") or ""

    destination_id = (context.get("trip") or {}).get("destinationId")

    index = None
    session_id = new_session_id()
    vector_places: list[dict[str, Any]] = []
    if destination_id:
        index = ensure_indexed(destination_id, places, content_hash)
        query_text = _last_user_query(body.messages)
        if query_text:
            vector_places = embed_query(index, query_text, session_id)
        if interest_terms:
            try:
                boost = interest_boost_places(index, interest_terms)
            except Exception:
                logger.exception("interest boost failed (non-fatal)")
                boost = []
            vector_places = _merge_places(vector_places, boost)

    answer = ""
    try:
        answer = run_agent(
            client=client,
            trip_id=body.tripId,
            user_id=resolved_user_id,
            context=context,
            vector_places=vector_places,
            history=[m.model_dump() for m in body.messages],
            locale=body.locale,
            interests=interest_terms,
        )
    except Exception as exc:
        logger.exception("agent run failed")
        raise AgentError(str(exc)) from exc
    finally:
        if index is not None:
            try:
                purge_session(index, session_id)
            except Exception:
                logger.exception("failed to purge q-* documents")

    day = _resolve_day(body.day, context)
    if day:
        try:
            client.save_chat(
                trip_id=body.tripId,
                user_id=resolved_user_id,
                day=day,
                messages=[m.model_dump() for m in body.messages] + [{"role": "assistant", "content": answer}],
            )
        except BackendError as exc:
            logger.warning("save-chat failed (code=%s): %s", exc.code, exc.message)
        except Exception:
            logger.exception("save-chat failed")

    return answer


def _run_day_plan_pipeline(
    client: BackendClient,
    body: DayPlanRequest,
    user_id: str,
    user_email: str | None,
) -> tuple[str, list[dict[str, Any]]]:
    context = client.get_trip_context(body.tripId, user_id, user_email)
    resolved_user_id = str(context.get("userId") or user_id)

    cache = client.get_places_cache(body.tripId, resolved_user_id, user_email)
    places = cache.get("places") or []
    content_hash = cache.get("contentHash") or ""

    destination_id = (context.get("trip") or {}).get("destinationId")

    index = None
    session_id = new_session_id()
    vector_places: list[dict[str, Any]] = []
    if destination_id:
        index = ensure_indexed(destination_id, places, content_hash)
        # Sin query del usuario, sembramos la búsqueda vectorial con el destino.
        query_text = (context.get("trip") or {}).get("destinationName") or "lugares recomendados"
        if query_text:
            vector_places = embed_query(index, query_text, session_id)

    answer = ""
    try:
        answer = run_day_plan_agent(
            client=client,
            trip_id=body.tripId,
            user_id=resolved_user_id,
            context=context,
            vector_places=vector_places,
            locale=body.locale,
        )
    except Exception as exc:
        logger.exception("day-plan agent run failed")
        raise AgentError(str(exc)) from exc
    finally:
        if index is not None:
            try:
                purge_session(index, session_id)
            except Exception:
                logger.exception("failed to purge q-* documents")

    plan = parse_plan_block(answer)
    return answer, plan


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _public_llm_config() -> dict[str, Any]:
    settings = get_settings()
    demo = is_demo_provider()
    return {
        "provider": "none" if demo else settings.llm_provider,
        "model": effective_model_name(),
        "baseUrl": settings.llm_base_url,
        "hasKey": bool(settings.llm_api_key) and not demo,
        "demo": demo,
    }


@app.get("/api/agent/config")
def agent_config() -> dict[str, Any]:
    """Provider status for the AI badge. Public; never returns the key."""
    return _public_llm_config()


@app.post("/api/agent/config")
def update_agent_config(
    body: LlmConfigRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> JSONResponse:
    """Persist provider settings from the app. Internal-token protected."""
    if not _internal_token_ok(x_internal_token):
        return _error(401, "AUTH_INVALID", "token interno inválido")
    try:
        update_override(
            provider=body.provider,
            api_key=body.apiKey or "",
            model=body.model or "",
            base_url=body.baseUrl or "",
            clear_key=body.clearKey,
        )
    except ValueError as exc:
        return _error(400, "LLM_CONFIG_INVALID", str(exc))
    return JSONResponse(status_code=200, content=_public_llm_config())


@app.post("/api/agent/suggestions")
async def suggestions(
    body: SuggestionsRequest,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> JSONResponse:
    identity = _authenticate(x_user_id)
    if isinstance(identity, JSONResponse):
        return identity
    user_id, user_email = identity

    client = BackendClient()

    try:
        answer = await asyncio.wait_for(
            asyncio.to_thread(_run_pipeline, client, body, user_id, user_email),
            timeout=AGENT_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        return _error(504, "AGENT_TIMEOUT", "El agente tardó demasiado en responder.")
    except BackendError as exc:
        if exc.status == 404:
            return _error(404, "CONTEXT_NOT_FOUND", exc.message)
        if exc.status == 403:
            return _error(403, "CONTEXT_FORBIDDEN", exc.message)
        return _error(502, "BACKEND_ERROR", exc.message)
    except AgentError as exc:
        return _error(500, "AGENT_ERROR", str(exc))
    except Exception as exc:
        logger.exception("unexpected error in suggestions")
        return _error(500, "AGENT_ERROR", str(exc))

    return JSONResponse(
        status_code=200,
        content={"answer": answer, "mode": "demo" if is_demo_provider() else "llm"},
    )


@app.post("/api/agent/auto-suggest")
async def auto_suggest_endpoint(
    body: AutoSuggestRequest,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> JSONResponse:
    identity = _authenticate(x_user_id)
    if isinstance(identity, JSONResponse):
        return identity
    user_id, user_email = identity

    client = BackendClient()

    try:
        result = await asyncio.to_thread(
            auto_suggest,
            client,
            body.tripId,
            user_id,
            user_email,
            body.offset,
            body.limit,
        )
    except NoInterestsError:
        return _error(
            422,
            "NO_INTERESTS",
            "Añade algunos intereses a tu perfil para recibir sugerencias.",
        )
    except BackendError as exc:
        if exc.status == 404:
            return _error(404, "CONTEXT_NOT_FOUND", exc.message)
        if exc.status == 403:
            return _error(403, "CONTEXT_FORBIDDEN", exc.message)
        return _error(502, "BACKEND_ERROR", exc.message)
    except Exception as exc:
        logger.exception("unexpected error in auto-suggest")
        return _error(500, "AUTO_SUGGEST_ERROR", str(exc))

    return JSONResponse(status_code=200, content=result)


@app.post("/internal/interests/sync")
async def interests_sync(
    body: InterestsSyncRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> JSONResponse:
    if not _internal_token_ok(x_internal_token):
        return _error(401, "AUTH_INVALID", "token interno inválido")

    user_id = body.userId.strip()
    if not user_id:
        return _error(400, "INVALID_ARGUMENT", "userId requerido")

    try:
        result = await asyncio.to_thread(sync_user_interests, user_id, body.terms)
    except Exception as exc:
        logger.exception("interests sync failed")
        return _error(500, "INTERESTS_SYNC_ERROR", str(exc))

    return JSONResponse(status_code=200, content=result)


@app.post("/api/agent/day-plan")
async def day_plan(
    body: DayPlanRequest,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
) -> JSONResponse:
    identity = _authenticate(x_user_id)
    if isinstance(identity, JSONResponse):
        return identity
    user_id, user_email = identity

    client = BackendClient()

    try:
        answer, plan = await asyncio.wait_for(
            asyncio.to_thread(_run_day_plan_pipeline, client, body, user_id, user_email),
            timeout=AGENT_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        return _error(504, "AGENT_TIMEOUT", "El agente tardó demasiado en responder.")
    except BackendError as exc:
        if exc.status == 404:
            return _error(404, "CONTEXT_NOT_FOUND", exc.message)
        if exc.status == 403:
            return _error(403, "CONTEXT_FORBIDDEN", exc.message)
        return _error(502, "BACKEND_ERROR", exc.message)
    except AgentError as exc:
        return _error(500, "AGENT_ERROR", str(exc))
    except Exception as exc:
        logger.exception("unexpected error in day-plan")
        return _error(500, "AGENT_ERROR", str(exc))

    return JSONResponse(status_code=200, content={"answer": answer, "plan": plan})
