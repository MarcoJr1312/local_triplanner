# Troubleshooting — local recruiter demo

## First checks

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f web
docker compose logs -f agent
```

All five services should be `healthy`: `web`, `api`, `agent`, `postgres`,
`mongo`.

## Docker Desktop is not running

Start Docker Desktop and wait for the whale icon. Then:

```bash
docker compose up -d
```

## Port already in use

Defaults: web `3000`, Postgres `5432`, MongoDB `27017`.

Create a root `.env` from `.env.example` and change:

```bash
WEB_PORT=3100
POSTGRES_PORT=55432
MONGO_PORT=27018
```

Then `docker compose up -d`. Open the URL with the new `WEB_PORT`.

## First build is slow

The first build compiles Next.js and installs Python dependencies. Later
builds use Docker layer cache. To rebuild from scratch:

```bash
docker compose build --no-cache
```

## `web` is unhealthy

Usually the API/agent is not healthy yet, or an env value is wrong.

```bash
docker compose logs web --tail 100
docker compose ps
```

The web container expects:

- `NEXT_PRIVATE_BACKEND_URL=http://api:4000/graphql`
- `NEXT_PRIVATE_BACKEND_ORIGIN=http://api:4000`
- `NEXT_PRIVATE_AGENT_URL=http://agent:4100`

These are set by `docker-compose.yml`; do not replace them with `localhost`.

## `api` is unhealthy

```bash
docker compose logs api --tail 100
```

Common causes:

- Postgres/Mongo not healthy yet: wait and re-run `docker compose ps`.
- Migration/seed failed: check the log for `Seed OK` or a stack trace.
- A stale volume from an older schema:

```bash
docker compose down -v
docker compose up --build
```

## Search returns no places

1. Check the seed log:

```bash
docker compose logs api | grep "Seed OK"
```

Expected: `1 destinos, 186 actividades, 80 imágenes`.

2. Check MongoDB:

```bash
docker exec local_triplanner-mongo mongosh triplanner --quiet --eval "db.locations.countDocuments()"
```

Expected: `187` (1 destination + 186 places).

3. Reset if needed:

```bash
docker compose down -v
docker compose up -d
```

## Seed images return 404

```bash
docker compose logs api | grep "imágenes"
docker compose exec api ls /app/uploads/seed | head
```

If the folder is empty, re-run the seed:

```bash
docker compose exec api bun run db:seed
```

The seed copies `backend/db/seed-images/` into the uploads volume.

## AI panel shows an error

The demo works without any provider. Verify:

```bash
curl -s http://localhost:3000/api/agent/config
```

Expected with defaults:

```json
{"provider":"none","model":"","demo":true}
```

If you configured a provider, check:

- `LLM_PROVIDER` is one of `none`, `deepseek`, `openai`, `anthropic`, `ollama`.
- `LLM_API_KEY` is set for DeepSeek/OpenAI/Anthropic.
- `LLM_MODEL` matches the provider.
- For Ollama on the host: `LLM_BASE_URL=http://host.docker.internal:11434/v1`.
- Rebuild/restart the agent: `docker compose up -d --build agent web`.

## No invitation email

Expected. This demo has no email provider. Use the **Copy link** button in the
invite modal.

## Ports on Windows

If Docker Desktop reports a port conflict, check:

```powershell
netstat -ano | findstr :3000
```

Change `WEB_PORT` in the root `.env` and restart.

## Apple Silicon

The base images (`pgvector/pgvector`, `mongo`, `node`, `python`, `oven/bun`) have
arm64 variants. If a build fails after switching architectures:

```bash
docker compose build --no-cache
```

## Reset everything

```bash
docker compose down -v
docker compose up --build
```

This deletes the Postgres, MongoDB and uploads volumes. The seed recreates the
demo on the next start.
