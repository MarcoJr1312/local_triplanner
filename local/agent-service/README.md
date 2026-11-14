# Tripsuggest agent service (local)

Servicio agente de Triplanner: sugerencias de viaje con FastAPI + Agno.
En el runner local la identidad es demo (`X-User-Id`), los embeddings viven en
Postgres con pgvector y el proveedor LLM es opcional.

## Arranque

```bash
cd local/agent-service
uv sync
uv run uvicorn tripsuggest.main:app --host 127.0.0.1 --port 4100
```

## Configuracion

- `DATABASE_URL` — Postgres con pgvector (misma base que el backend).
- `BACKEND_URL` — backend interno (default `http://127.0.0.1:4000`).
- `INTERNAL_TOKEN` — secreto compartido para `/internal/*`.
- `DEEPSEEK_API_KEY` — key opcional del proveedor LLM.
- `AGENT_LLM_MODEL`, `AGENT_LLM_BASE_URL` — modelo/endpoint opcionales.

## Endpoints

- `GET /health` → `{"status": "ok"}`
- `POST /api/agent/suggestions` — header `X-User-Id`, body
  `{ tripId, messages: [{role, content}], locale: "es"|"en", day? }`
- `POST /api/agent/auto-suggest` — header `X-User-Id`, body
  `{ tripId, offset?, limit? }`; determinista sobre pgvector.
- `POST /api/agent/day-plan` — header `X-User-Id`, body
  `{ tripId, day, locale? }`.
- `POST /internal/interests/sync` — header `X-Internal-Token`, body
  `{ userId, terms: string[] }`.

## Estructura

- `src/tripsuggest/main.py` — app FastAPI y endpoints.
- `src/tripsuggest/auth.py` — identidad demo (`X-User-Id`).
- `src/tripsuggest/agent.py` — prompt y ejecucion del agente.
- `src/tripsuggest/auto_suggest.py` — auto-suggest determinista.
- `src/tripsuggest/vector_store.py` — pgvector para almacenamiento; embedding local.
- `src/tripsuggest/tools.py` — tools de lugares sobre el backend.
