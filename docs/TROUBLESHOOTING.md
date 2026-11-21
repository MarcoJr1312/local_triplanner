# Troubleshooting — local recruiter demo

## First checks

```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f api
docker compose -f deploy/docker-compose.yml logs -f web
docker compose -f deploy/docker-compose.yml logs -f agent
```

All six services should be `healthy`: `web`, `api`, `locations`, `agent`,
`postgres`, `mongo`.

## Docker Desktop is not running

Start Docker Desktop and wait for the whale icon. Then:

```bash
docker compose -f deploy/docker-compose.yml up -d
```

## Port already in use

Defaults: web `3000`, Postgres `5432`, MongoDB `27017`.

Create a root `.env` from `.env.example` and change:

```bash
WEB_PORT=3100
POSTGRES_PORT=55432
MONGO_PORT=27018
```

Then `docker compose -f deploy/docker-compose.yml up -d`. Open the URL with the new `WEB_PORT`.

## First build is slow

The first build compiles Next.js and installs Python dependencies. Later
builds use Docker layer cache. To rebuild from scratch:

```bash
docker compose -f deploy/docker-compose.yml build --no-cache
```

## `web` is unhealthy

Usually the API/agent is not healthy yet, or an env value is wrong.

```bash
docker compose -f deploy/docker-compose.yml logs web --tail 100
docker compose -f deploy/docker-compose.yml ps
```

The web container expects:

- `NEXT_PRIVATE_BACKEND_URL=http://api:4000/graphql`
- `NEXT_PRIVATE_BACKEND_ORIGIN=http://api:4000`
- `NEXT_PRIVATE_AGENT_URL=http://agent:4100`

These are set by `docker-compose.yml`; do not replace them with `localhost`.

## `api` is unhealthy

```bash
docker compose -f deploy/docker-compose.yml logs api --tail 100
```

Common causes:

- Postgres/Mongo not healthy yet: wait and re-run `docker compose -f deploy/docker-compose.yml ps`.
- Migration/seed failed: check the log for `Seed OK` or a stack trace.
- A stale volume from an older schema:

```bash
docker compose -f deploy/docker-compose.yml down -v
docker compose -f deploy/docker-compose.yml up --build
```

## Search returns no places

1. Check the seed log:

```bash
docker compose -f deploy/docker-compose.yml logs api | grep "Seed OK"
```

Expected: `Seed OK — Postgres listo; catálogo en locations-service, 80 imágenes`.

2. Check MongoDB (authenticated):

```bash
docker exec local_triplanner-mongo mongosh \
  "mongodb://triplanner:triplanner@localhost:27017/triplanner?authSource=admin" \
  --quiet --eval "db.locations.countDocuments()"
```

Expected: `187` (1 destination + 186 places). Use `MONGO_USERNAME` /
`MONGO_PASSWORD` from `.env` if you changed the demo defaults.

3. Check the locations settings and provider:

```bash
docker exec local_triplanner-locations curl -s http://localhost:4300/ready
docker exec local_triplanner-locations curl -s http://localhost:4300/api/locations/config
```

`provider=preloaded` is the key-free default. `provider=hasdata` means a
HasData key is saved; remove it in Settings → Places data to return to the
committed catalogue.

4. If Mongo was created before auth was enabled, create the root user once or
reset the volume:

```bash
docker compose -f deploy/docker-compose.yml down -v
docker compose -f deploy/docker-compose.yml up -d
```

5. Reset if needed:

```bash
docker compose -f deploy/docker-compose.yml down -v
docker compose -f deploy/docker-compose.yml up -d
```

## Seed images return 404

```bash
docker compose -f deploy/docker-compose.yml logs api | grep "imágenes"
docker compose -f deploy/docker-compose.yml exec api ls /app/uploads/seed | head
```

If the folder is empty, re-run the seed:

```bash
docker compose -f deploy/docker-compose.yml exec api bun run db:seed
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
- Rebuild/restart the agent: `docker compose -f deploy/docker-compose.yml up -d --build agent web`.

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
docker compose -f deploy/docker-compose.yml build --no-cache
```

## Reset everything

```bash
docker compose -f deploy/docker-compose.yml down -v
docker compose -f deploy/docker-compose.yml up --build
```

This deletes the Postgres, MongoDB, locations settings and uploads volumes.
The seed recreates the demo on the next start.
