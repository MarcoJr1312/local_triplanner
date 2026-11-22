# Triplanner — Frontend (Next.js)

Next.js 15 App Router frontend for the Triplanner local demo. The browser only
talks to this origin; all backend calls go through server-side route handlers.

## Stack

- Next.js 15 App Router + React 19 + TypeScript strict
- Tailwind CSS (brand #6C3BFF, Inter Variable)
- lucide-react icons
- Data facade: `lib/api.ts` → `fetch('/api/graphql')`

## Architecture

```text
Browser → Next (:3000)
            ├─ /api/graphql  → API GraphQL (:4000), including SSE
            ├─ /api/agent/*  → Agent (:4100)
            ├─ /uploads/*    → API uploads (:4000)
            ├─ /api/health   → process liveness
            └─ /api/ready    → config + API readiness
```

- The browser never calls the API or agent directly.
- No sensitive `NEXT_PUBLIC_*` variables.
- Product UI is **English by default**; Spanish is available in Settings.

## Runtime configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PRIVATE_BACKEND_URL` | yes | `http://127.0.0.1:4000/graphql` | API GraphQL |
| `NEXT_PRIVATE_BACKEND_ORIGIN` | recommended | derived from the GraphQL URL | `/uploads/*` |
| `NEXT_PRIVATE_AGENT_URL` | yes | `http://127.0.0.1:4100` | agent proxy |

All values are read at request time, so one image works in Compose, Helm and
local development. See [`.env.example`](./.env.example).

## Routes

| Route | Purpose |
|---|---|
| `/login` | Username/password login, account create/delete |
| `/` | Trips dashboard |
| `/trip/[id]` | Itinerary, budget, members, invites, AI |
| `/api/graphql` | GraphQL proxy (POST + SSE) |
| `/api/agent/[...path]` | Agent proxy |
| `/uploads/[...path]` | Same-origin attachment/avatar proxy |
| `/api/health` | liveness, no backend call |
| `/api/ready` | required config + API `/health` within 2 s |

## Development

```bash
bun install
bun run dev     # http://localhost:3000
bun test
bunx tsc --noEmit
bun run build
bun run start
```

Requires the API on `:4000` and agent on `:4100` for full functionality. Without
them the proxy returns a clear 502 and the UI shows empty/degraded states.

## Rules

- Every user-facing string goes through `t()` with mirrored es/en keys.
- Use `'use client'` only for components that need hooks.
- Zero credentials in the browser. Zero AWS.
- Run tests, typecheck and build before commit.
