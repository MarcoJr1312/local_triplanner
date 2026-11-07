# AGENTS.md — triplanner

Project: **triplanner** — collaborative travel planning web app (itinerary, day plans, attachments with per-file visibility, real-time collaboration, AI activity suggestions, routes/Uber deep links). Product UI is **Spanish by default**, with an es/en switch.
Orkai category id: `9d92eb65d30a3ffb96c50d69b9171404`.
Owner: Marco (GitHub `MarcoJr1312`). Lead: Hermes (software factory).

**Call `overview()` and read `project_preferences` (category above) before doing anything else.** `project_preferences` is the authoritative working agreement: phase, pinned cycle, team roster, gates, URLs and delivery mode.

## Factory working rules (this project)

- **Phase:** production — the app is live at `https://gathered.woky.dev` behind Basic Auth. A defect here is a user-facing defect.
- **Pinned cycle:** the cycle named in `project_preferences.metadata.cycle_id`. `project-manager` walks THAT cycle; there is no fallback ladder. A cycle step naming an entity outside this category is broken — stop and instantiate it here.
- **Gates:** nothing advances without human approval recorded in entity metadata (`approved_by` + `approved_at`). HITL nodes are text steps opening with `HITL Required to continue.` Mechanical check: `bash /root/software-factory/scripts/factory-gate.sh 9d92eb65d30a3ffb96c50d69b9171404 <mock|delegation|plan|tasks>`.
- **Mock gate:** every user-visible surface gets an approved mock, or an explicit recorded exemption (`mock_not_applicable` + `mock_na_reason` on the requirement) when the work is a bugfix round inside already approved UX contracts.
- **Delegation:** all implementation runs through a hired employee — `bash /root/software-factory/scripts/factory-run.sh 9d92eb65d30a3ffb96c50d69b9171404 --employee <workflow-id> --prompt <file>`. Running `opencode run --agent build` directly is **forbidden** for project work.
- **Roles are unique to this project.** The `software-factory` category holds templates only (`role-baseline: <Role>`, `Palette — <type>`). Never reference a factory id or another project's entity; instantiate here.
- Knowledge entities (standards, skills, requirements, architecture, sessions) are written in **English**. Chat adapts to whoever is speaking.

## Stack and conventions (verified 07-nov-2026)

- **Frontend `frontend-next/` — Next.js 15 App Router + React 19** (shadcn/ui on Radix, Tailwind v4), Spanish UI with es/en i18n. Dev `:3000`. The browser only talks to `/api/graphql` (route handler proxying to the GraphQL server); never expose a sensitive `NEXT_PUBLIC_*`.
- **Backend `local/server/` — TypeScript on Bun, graphql-yoga `:4000`** over SQLite, `firebase-admin` + `jose` for Firebase token verification. `bun test` and `bunx tsc --noEmit` must stay green.
- **Agent `local/agent-service/` — Python 3.12, uv, FastAPI + Agno + ChromaDB + DeepSeek**, `uv run uvicorn tripsuggest.main:app --port 4100`, read-only tools over trip context.
- **Data `local/db/`** — `schema.sql` (versioned) + idempotent `seed.js`; the SQLite file and Chroma data are gitignored and never travel.
- **Package manager: bun** in both JS projects (committed `bun.lock`, no `package-lock.json`).
- **Legacy frontend `frontend/` — React/Vite `:5173`**: still in the repo, retired once Next is fully validated. New work goes to `frontend-next/`.
- **Production**: `NEXT_PROD=1` build + `next start` on `:3001`, served by nginx at `gathered.woky.dev` behind Basic Auth (`marco`, `loba`). Redeploy after each feature.
- **Zero AWS deploys without explicit authorization.** The original AWS stack (AppSync/DynamoDB/Cognito/Terraform) lives in `/root/gathered` as reference only; it is not this project's working tree.
- **Branches:** one branch per feature (`feature/*`), push only to that branch, never to `main`. Commit only when the owner asks.
- Secrets never committed: `local/.env`, `firebase-service-account.json`, `*.sqlite`, `uploads/`, `node_modules/`, `.next/`, Chroma data.

## Domain conventions (already shipped — do not regress)

- **HasData search**: cache-first, key only in `local/.env` (backend). Search results put favorites first (LEFT JOIN + fallback reorder).
- **Avatars**: upload via `updateMyProfile` (data URL) → `local/server/uploads/avatars/` (gitignored), served at `/uploads/*` by the backend plus a Next rewrite for same-origin. png/jpeg/webp, max 2MB.
- **Activity attachments**: `addItemAttachment` → `uploads/attachments/<itemId>/<uuid>.<ext>`; pdf/png/jpeg/webp, max 10MB; PDF inline in an iframe, no toolbar (`#toolbar=0`). Trip members only, and visibility is chosen by the uploader (per-file viewers, bytes only via short-lived HMAC URL).
- **Favorites**: table `user_favorites` (PK user_id + location_id), mutation `favoriteLocation`, `isFavorite` on Location/Activity.
- **Routes**: `TripItem.lat/lng` and `Trip.destinationLat/Lng`; "Formar ruta" opens `RouteModal` for the origin, then `https://www.google.com/maps/dir/<origin>/<stops>` in a new tab. Items with a time sorted by `startTime`, untimed last, manual items excluded, max 10 stops (`lib/routes.ts`). No Google API keys.
- **Uber**: deep link per activity with the destination preloaded. Never preloads a pickup point.
- **i18n**: every UI string goes through `t()`; `es` and `en` keys are mirrored; API errors travel as stable codes.

## Local dev stack — commands

```bash
# Backend (GraphQL :4000, SQLite)
cd local/server && bun run dev

# Frontend (Next :3000, proxies /api/graphql → :4000)
cd frontend-next && bun run dev

# Agent service (:4100)
cd local/agent-service && uv run uvicorn tripsuggest.main:app --port 4100

# Seed the local DB (idempotent)
cd local/db && node seed.js
```

Report the dev port to the owner for manual testing.

## Troubleshooting — stale Vite HMR state

After many agent-driven edits/HMR cycles, the Vite dev server can end up serving a corrupted module graph: pages mount EMPTY (body renders nothing) with no console errors, especially the trip detail page. Fix: restart the dev server and hard-refresh the browser (Ctrl+Shift+R). Before debugging "my data is not showing", verify with `curl http://localhost:4000/graphql` that the backend returns data — if it does, the frontend dev server is the suspect.

## Troubleshooting — Next.js `Cannot find module './<n>.js'`

NEVER run `next build` while `next dev` is serving the same `.next` dir: the production build overwrites dev chunks and the server starts throwing `Cannot find module './887.js'` (or any numbered chunk). Fix: kill the dev server, `rm -rf frontend-next/.next`, restart. Build and dev must use separate `.next` dirs, or stop dev before building.

Also clean `.next` whenever switching package manager/runtime (npm ↔ bun) or after big dependency changes: stale chunks surviving the switch are the #1 cause of hydration mismatch overlays that cannot be reproduced in a fresh browser session.

---

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
3. **Load project_preferences** for this category — phase, pinned cycle, team, gates.
4. **Brief the user**: summarize what you found (previous session, current
   status, relevant decisions).

### During the Session

**Search before reading files.** Use search_code(query) to find code by meaning.
It returns symbols with file paths, line numbers, signatures, and AI annotations.
Only fall back to Grep/Read if search doesn't find what you need.

**Check standards before deciding.** Before architecture or pattern decisions:
  standards(action: "search", query: "<topic>", category_ids: ["9d92eb65d30a3ffb96c50d69b9171404"])
  skills(action: "search", query: "<topic>", category_ids: ["9d92eb65d30a3ffb96c50d69b9171404"])
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
| project_preferences | Singleton per project category — phase, cycle, team, gates |
| standards(action, ...) | Engineering guidelines |
| skills(action, ...) | Implementation patterns |
| requirements(action, ...) | Business/product intent |
| architectures(action, ...) | System structure and boundaries |
| plan / milestone / tasks | Roadmaps and work tracking |
| categories(action, ...) | Organize entities — unindex cascade-deletes |
| documents(action, ...) | Reference documents |
| analytics(action, ...) | Tabular datasets — schema, query, JOINs |
| search_code(query) | Semantic code search (enrich?, include_annotations?) |
| search_document(query) | Semantic document search |
| entity(action, ...) | Generic CRUD (escape hatch) |
| help() | MCP tool schema only — not product how-to |

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
orkai review                     # LLM code review against stored standards
```

---

## Project initializer (std-initializer, this project)

Bootstrap rules specific to this project live in the `std-initializer` standard **of this category** — read it before recreating this file, touching the dataset rows, or re-resolving ids on another machine. Ids in any export are machine-local: re-resolve by name after `orkai init -y`, never paste an origin id here.
