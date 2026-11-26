# Docker Compose setup

Run the full Triplanner demo on one machine with Docker Compose. This is the
fastest setup and the recommended first run for a recruiter demo. No Firebase,
AWS, HasData or LLM account is required.

[← Back to the main README](../../../README.md)

## Prerequisites

- **Docker Desktop** running (4 GB RAM available; 8 GB recommended).
- **Git** to clone the repository.
- Free host ports **3000** (web), **5432** (PostgreSQL) and **27017** (MongoDB).
  The database ports bind to `127.0.0.1` only; set `WEB_PORT` if 3000 is busy.

## Quickstart (source build)

```bash
git clone https://github.com/MarcoJr1312/local_triplanner.git
cd local_triplanner
docker compose -f deploy/docker-compose.yml up --build
```

The first build takes a few minutes. Open
[http://localhost:3000/login](http://localhost:3000/login) and sign in with:

| Account | Password | Role |
|---|---|---|
| `demo` | `demo123` | Demo owner |
| `demo-friend` | `demo123` | Collaborator |

Check the stack:

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f api
```

Stop the stack and keep data:

```bash
docker compose -f deploy/docker-compose.yml down
```

Reset the demo data (the next start re-seeds it):

```bash
docker compose -f deploy/docker-compose.yml down -v
```

## What runs

| Service | Purpose | Host access |
|---|---|---|
| `web` | Next.js UI | http://localhost:3000 |
| `api` | GraphQL API facade | internal `:4000` |
| `users` | Accounts, login, notifications | internal `:4500` |
| `trips` | Trips, members, items, invitations | internal `:4400` |
| `locations` | Toronto catalogue and search | internal `:4300` |
| `agent` | FastAPI suggestions | internal `:4100` |
| `kafka` | Go demo broker (HTTP + SQLite) | internal `:8080` |
| `postgres` | Platform PostgreSQL 17 + pgvector | `127.0.0.1:5432` |
| `trips-postgres` | Trips service PostgreSQL | internal |
| `users-postgres` | Users service PostgreSQL | internal |
| `agent-postgres` | Agent PostgreSQL 17 + pgvector | internal |
| `mongo` | Toronto location catalogue | `127.0.0.1:27017` |

The Compose demo does not run the email consumer. Invitations still work through
the in-app notification bell and the copyable join link; email delivery is part
of the Helm deployment.

## Run published images

Use the Hub stack to skip the local build. It pulls the published multi-arch
images from Docker Hub:

```bash
docker compose -f deploy/docker-compose.hub.yml up -d
```

The file defaults to the `marcojr13` namespace and the published tags. To pin
the `v1.8.0` release explicitly:

```bash
IMAGE_TAG=1.8.0 \
LOCATIONS_IMAGE_TAG=1.8.0 \
USERS_IMAGE_TAG=1.8.0 \
KAFKA_IMAGE_TAG=1.8.0 \
  docker compose -f deploy/docker-compose.hub.yml up -d
```

PowerShell: set the same values with `$env:IMAGE_TAG='1.8.0'` (and the other
names) before running `docker compose`.

For a fork, override the namespace, for example
`DOCKERHUB_USERNAME=youruser docker compose -f deploy/docker-compose.hub.yml up -d`,
and make sure the images exist under that namespace. The source-build stack is
the reliable option when they do not.

## Verify the demo

```bash
# Windows
powershell -ExecutionPolicy Bypass -File scripts/smoke.ps1

# macOS / Linux
bash scripts/smoke.sh
```

The smoke script checks the container health, demo login, place search, users
service login and the agent's deterministic suggestions. Set `WEB_URL` if the
web runs on another port.

## What to try

1. Open the seeded Toronto trip (Dec 4–6, 2026).
2. Search for **CN Tower**, **ROM** or a restaurant.
3. Invite **`demo-friend`** from the trip's **Invitar → Por usuario** tab, then
   sign in as `demo-friend` / `demo123` and accept from the bell.
4. Upload an avatar or an activity attachment.
5. Ask the AI agent for suggestions.

## Optional integrations

All keys are optional and are entered in the app. They are stored on the
service volumes, never returned to the browser and never needed for the demo.

- **AI provider** — **Settings → AI provider** selects DeepSeek, OpenAI,
  Anthropic or a local Ollama. The default is `LLM_PROVIDER=none`, which uses
  deterministic answers and shows the **AI demo mode** badge.
- **Email delivery** — **Settings → Email delivery** stores a Resend key. The
  Compose stack has no email consumer, so use the bell or copyable link.
- **Places data** — **Settings → Places data** switches from the committed
  Toronto catalogue to HasData. Results are cached in MongoDB for 5 days.

To set LLM defaults for the containers, create a root `.env` from the example:

```bash
cp .env.example .env
# then set LLM_PROVIDER, LLM_API_KEY, LLM_MODEL as needed
docker compose -f deploy/docker-compose.yml up -d --build agent web
```

The backend, locations and agent environment variables are documented in the
main README's [Configuration](../../../README.md#configuration) section.

## Troubleshooting

- **Port 3000 is busy** — run with `WEB_PORT=3001 docker compose -f
  deploy/docker-compose.yml up --build` and open
  http://localhost:3001.
- **A service is unhealthy** — inspect it with
  `docker compose -f deploy/docker-compose.yml logs <service>`.
- **Stale demo data** — `docker compose -f deploy/docker-compose.yml down -v`
  removes the volumes; the next start re-seeds the Toronto catalogue and demo
  accounts.
- **Docker Desktop restarted** — wait for the engine, then rerun
  `docker compose -f deploy/docker-compose.yml up -d`.

More fixes: [Troubleshooting](../../TROUBLESHOOTING.md).

## Cleanup

```bash
docker compose -f deploy/docker-compose.yml down -v
```

For the Helm path, see [Helm setup](../helm/README.md).
