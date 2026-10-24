# Tripsuggest agent service (local)

Servicio agente de Triplanner: sugerencias de viaje con LLM (FastAPI + Agno +
DeepSeek) + índice vectorial local (ChromaDB). M3 = endpoint real de sugerencias.

## Arranque

```bash
cd local/agent-service
uv sync
uv run uvicorn tripsuggest.main:app --host 127.0.0.1 --port 4100
```

El servicio lee la configuracion del entorno (o de un `.env` local — ver
`.env.example`):

- `DEEPSEEK_API_KEY` — key de DeepSeek (obligatoria para el LLM).
- `INTERNAL_TOKEN` — secreto compartido para los endpoints internos del backend
  local (en dev el backend usa `dev-internal-token`).
- `AGENT_FIREBASE_SERVICE_ACCOUNT_PATH` — service account del Admin SDK
  (default: `firebase-service-account.json`, el mismo que usa el backend local).
- `FIREBASE_PROJECT_ID` — proyecto cuyos tokens se verifican (default `triplanner-a0e06`).

## Endpoints

- `GET /health` → `{"status": "ok"}`
- `POST /api/agent/suggestions` — `Authorization: Bearer <firebase token>`,
  body `{ tripId, messages: [{role, content}], locale: "es"|"en", day? }` →
  `{ "answer": "..." }`.
- `POST /api/agent/auto-suggest` — misma auth (Firebase o demo `X-User-Id`),
  body `{ tripId, offset?: number = 0, limit?: number = 10 }` →
  `{ items: [{placeId, title, category, cost, score}], hasMore, offset }`.
  Determinista (sin LLM): media de los embeddings de `user-interests` →
  `dest-<destinationId>`, score = `round((1 - cosine distance) * 100)`.
  Sin intereses → `422 NO_INTERESTS`.
- `POST /internal/interests/sync` — `X-Internal-Token`, body
  `{ userId, terms: string[] }` → `{ synced, deleted }`. Diff idempotente de la
  colección `user-interests` (ids estables `ui-<userId>-<sha1(term)[:12]>`).

Errores (códigos estables para localizar en el frontend):

| HTTP | código | causa |
|------|--------|-------|
| 401  | `AUTH_INVALID` | token Firebase inválido |
| 403  | `CONTEXT_FORBIDDEN` | el usuario no es miembro del viaje |
| 404  | `CONTEXT_NOT_FOUND` | el viaje no existe |
| 504  | `AGENT_TIMEOUT` | el agente tardó más de 90 s |
| 500  | `AGENT_ERROR` | fallo interno del agente |

## Estructura

- `src/tripsuggest/main.py` — app FastAPI + endpoint.
- `src/tripsuggest/agent.py` — system prompt + armado/ejecución del agente.
- `src/tripsuggest/tools.py` — tools `search_places` / `get_place_details`.
- `src/tripsuggest/chroma_store.py` — índice Chroma persistente por destino
  (`data/chroma`, gitignored), colección `user-interests`, consultas efímeras
  `q-*` purgadas tras responder (nunca toca `ui-*`).
- `src/tripsuggest/auto_suggest.py` — auto-suggest determinista (paginado +
  score). `src/tripsuggest/interests.py` — normalización, ids estables y mean
  pooling.
- `tests/test_m2.py` — tests de M2 con Chroma en directorios temporales:
  `uv run python tests/test_m2.py`.
- `src/tripsuggest/backend.py` — cliente HTTP de los endpoints `/internal/*`.
- `src/tripsuggest/auth.py` — verificación de token Firebase.
- `src/tripsuggest/provider.py` — modelo DeepSeek (Agno).

Nunca commitees `.env`, el service account JSON ni `data/` (ver `.gitignore`).
