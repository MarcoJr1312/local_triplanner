# AGENTS.md — gathered (Triplanner)

Project-specific context for any AI agent working in this repo.

## Project

- **Orkai category_id: `9d92eb65d30a3ffb96c50d69b9171404`** — use this id in every Orkai MCP call. The MCP server is HTTP and has no knowledge of your local directory, so this file is the ONLY way you learn your category scope.
- App: Triplanner — collaborative travel planning (UI in Spanish).
- Stack: AWS serverless (AppSync, DynamoDB, Cognito, Bedrock), Terraform in `infra/`, frontend in `frontend/` (React/Vite/TS), backend in `backend/`.
- Lead agent: Hermes (software factory). Other agents work inside this project; never bootstrap new projects.

## Conventions

- One git branch per feature; push ONLY to that branch, never to main.
- Zero AWS deploys without explicit authorization.
- Report local dev server ports for manual testing.

## Local dev/staging stack (`local/` + `frontend-next/`)

- Backend (TypeScript): `cd local/server && bun src/index.ts` (GraphQL on :4000, SQLite, HasData cache-first). Runtime Bun (TS nativo, sin build step); `bun test` (10 tests) y `bunx tsc --noEmit` en verde. Lockfile: bun.lock.
- Frontend (Next.js 15 App Router): `cd frontend-next && bun run dev` (:3000). El navegador solo habla con `/api/graphql` (proxy route handler → :4000). HASDATA_API_KEY vive SOLO en `local/.env` (backend); prohibido `NEXT_PUBLIC_*` sensible.
- Package manager: **bun** (ambos proyectos; bun.lock commiteado, sin package-lock.json).
- Avatares: subida via mutation updateMyProfile (data URL) → `local/server/uploads/avatars/` (gitignored); servidos en `/uploads/*` (backend :4000 + rewrite en Next para mismo origen). Solo png/jpeg/webp, max 2MB.
- Adjuntos de actividades: mutation addItemAttachment → `local/server/uploads/attachments/<itemId>/<uuid>.<ext>`; pdf/png/jpeg/webp max 10MB; PDF servido inline (iframe); solo miembros del trip. Preview en popup flotante redimensionable con visor sin toolbar (`#toolbar=0`: sin descargar/zoom).
- Favoritos: tabla `user_favorites` (PK user_id+location_id), mutation `favoriteLocation`, `isFavorite` en Location/Activity; favoritos SIEMPRE primero en searchLocations y listActivities (LEFT JOIN + reorden fallback HasData).
- Rutas: `TripItem.lat/lng` y `Trip.destinationLat/Lng` (JOIN locations); boton "Formar ruta" (dia seleccionado) abre el popup `RouteModal` para que el usuario escriba su **punto de partida** y luego abre `https://www.google.com/maps/dir/<origen>/<paradas>` en pestaña nueva; si lo deja vacio, origen libre (`/dir//`). Actividades con hora ordenadas por startTime, sin hora al final, manuales fuera, tope 10 paradas (`lib/routes.ts`). Sin APIs/keys de Google.
- App Vite legacy en `frontend/` (modo local: `VITE_LOCAL_GRAPHQL=http://localhost:4000/graphql`). Se retira cuando Next esté 100% validado.
- Key never committed: `local/.env` (gitignored), `.env.example` in repo.

### Troubleshooting — stale Vite HMR state

After many agent-driven edits/HMR cycles, the Vite dev server can end up
serving a corrupted module graph: pages mount EMPTY (body renders nothing)
with no console errors, especially the trip detail page. Fix: restart the dev
server (kill `npm run dev`, start it again) and hard-refresh the browser
(Ctrl+Shift+R). Before debugging "my data is not showing", verify with
`curl http://localhost:4000/graphql` that the backend actually returns the
data — if yes, the frontend dev server is the suspect.

### Troubleshooting — Next.js `Cannot find module './<n>.js'`

NEVER run `next build` while `next dev` is serving the same `.next` dir: the
production build overwrites dev chunks and the server starts throwing
`Cannot find module './887.js'` (or any numbered chunk). If it happens: kill
the dev server, `rm -rf frontend-next/.next`, restart `npm run dev`, and
hard-refresh the browser. Build and dev must use separate `.next` dirs (or
stop dev before building).

Also clean `.next` (`rm -rf frontend-next/.next`) whenever switching package
manager/runtime (npm ↔ bun) or after big dependency changes: stale chunks
surviving the switch are the #1 cause of hydration mismatch overlays
("A tree hydrated but some attributes...") that CANNOT be reproduced in a
fresh browser session.

## orkai — Persistent Memory

orkai gives you persistent memory across sessions. Standards, skills, session
summaries, and indexed source code are stored and semantically searchable.
Without it, every session starts from zero. With it, you compound knowledge.

**Call overview() before doing anything else.**

### HARD RULE — orkai product questions

If the user asks how orkai works (install, config, sessions, review, work, MCP,
continue previous session, etc.):

1. Call overview() and find **Orkai Help** under Workflows.
2. workflow(action: "get", id: "<Orkai Help uuid>") and follow that workflow.
3. MCP help() is **tool schema only** — never use it for product guidance.

### Session Startup

1. **Call overview()** — returns recent sessions, standards, skills, requirements,
   architecture, entity counts, and a tool reference. One call gives you full orientation.
2. **Load the latest session**: session(action: "latest", category_ids: ["9d92eb65d30a3ffb96c50d69b9171404"])
   — or session(action: "get", id: "<session_id>") from the overview preview.
3. **Brief the user**: summarize what you found (previous session, current
   status, relevant decisions).

### During the Session

**Search before reading files.** Use search_code(query) to find code by meaning.
It returns symbols with file paths, line numbers, signatures, and AI annotations.
Only fall back to Grep/Read if search doesn't find what you need.

**Check standards before deciding.** Before architecture or pattern decisions:
  standards(action: "search", query: "<topic>")
  skills(action: "search", query: "<topic>")
Follow them if they exist — they represent team-agreed conventions.

### Session End

When the user signals the session is ending:
1. Ask: "Would you like me to save this session?"
2. If yes: session(action: "create", name: "Session: <topic> - <date>",
   text: "<what was done, what's pending, key decisions, files modified>",
   category_ids: ["9d92eb65d30a3ffb96c50d69b9171404"])
3. Suggest running "orkai index" if source files were modified.

### Tool Quick Reference

| Tool | Purpose |
|------|---------|
| overview() | Session briefing — start here |
| session(action, ...) | Work session summaries (incl. latest) |
| standards(action, ...) | Engineering guidelines |
| skills(action, ...) | Implementation patterns |
| requirements(action, ...) | Business/product intent |
| architectures(action, ...) | System structure and boundaries |
| user_preferences / agent_preferences | Singleton prefs — create upserts; get without id |
| plan / milestone / tasks | Roadmaps and work tracking |
| categories(action, ...) | Organize entities — unindex cascade-deletes |
| documents(action, ...) | Reference documents |
| analytics(action, ...) | Tabular datasets — schema, query, JOINs |
| annotations(action, ...) | Purpose + insight code annotations |
| search_code(query) | Semantic code search (enrich?, include_annotations?) |
| search_document(query) | Semantic document search |
| entity(action, ...) | Generic CRUD (escape hatch) |
| help() | MCP tool schema only — not product how-to |
| project_setup(action) | Generate agent instruction files |

### CLI Commands

```
orkai init                       # project wizard
orkai index                      # re-index (default: all)
orkai index code|document|analytics
orkai index --github owner/repo  # ephemeral clone + index
orkai unindex <id|name>
orkai status                     # health, entity counts
orkai search "query"             # semantic search
orkai get <id> --annotations     # view entity + AI annotations
orkai list --type <type>         # browse entities by type
orkai export / import <category> # JSONL knowledge migration
orkai index --annotations-only   # AI annotations for code
orkai review                     # LLM code review against stored standards
```

orkai review is a CLI code-review command: it reviews your changes against the
standards and architecture decisions stored in orkai, protecting source-code
quality. Run "orkai review --help".
