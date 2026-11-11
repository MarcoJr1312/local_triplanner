# Local dev/staging environment — Triplanner

Entorno local completo: frontend-next (3000) + backend GraphQL local (4000) + SQLite + búsqueda de lugares con HasData.

## Estructura

- `db/` — SQLite (`triplanner.sqlite`, gitignored) + esquema (`schema.sql`), seed (`seed.js`) y sus datos (`seed-data.json`)
- `server/` — servidor GraphQL local (graphql-yoga) con el schema base de `local/graphql/schema.graphql` + extensiones locales (`searchLocations`, `locationDetails`)
- `graphql/` — schema base heredado del contrato original de AppSync (`schema.graphql`); sin resolvers de AppSync
- `.env.example` — plantilla de configuración; copiar a `.env` (gitignored)

## Setup (primera vez)

```bash
# 1. Key de HasData (https://app.hasdata.com/api-keys)
cp .env.example .env          # y completa HASDATA_API_KEY en .env

# 2. Base de datos + seed idempotente (2 destinos, 52 actividades + demo user/trip)
cd local/db && node seed.js

# 3. Dependencias del servidor
cd ../server && npm install
```

## Levantar el stack

```bash
# Backend GraphQL local en localhost:4000
cd local/server && npm start

# Frontend Next (proxy /api/graphql -> :4000)
cd frontend-next && bun run dev
```

## Pruebas del servidor

```bash
cd local/server && npm test        # tests unitarios con mocks (sin creditos de HasData)
```

## Comportamiento clave

- **Cache-first**: la búsqueda (`searchLocations`) consulta FTS5 en SQLite; solo si no hay resultados llama a HasData (`GET /scrape/google-maps/search`, ~10 créditos), normaliza (categoría mapeada a `sight|food|activity|nightlife`, `raw_type` original) y guarda en `locations` (upsert por `place_id`).
- **Detalle bajo demanda**: `locationDetails(placeId)` devuelve de DB si ya hay detalle; si no, llama a `GET /scrape/google-maps/place` + `fetchWebResults` (+15 créditos, una sola vez por lugar) y guarda horarios/web/redes.
- **Top 10 del destino**: `listActivities` devuelve hasta 10 lugares ordenados por rating → nº de reviews → nombre; si hay menos, los que haya.
- **Sugerencias IA locales**: `requestSuggestions` es determinista (sin Bedrock): 5 sugerencias del catálogo del destino con variedad de categorías, priorizando rating y encaje en el presupuesto restante.
- **Auth demo**: header `x-user-id` (default `demo-user`); sin Cognito en local.

## Reglas

- `.env` y `*.sqlite` jamás se commitean (ver `.gitignore`)
- Cero AWS en dev/staging (nada de terraform apply ni llamadas a servicios AWS)
- La key de HasData nunca va al frontend, logs ni commits
- Producción sigue siendo AWS (AppSync/DynamoDB/Bedrock) — este entorno no la reemplaza

## Puertos

- Frontend: `5173` · Backend: `4000`
- Acceso remoto: `ssh -L 5173:localhost:5173 -L 4000:localhost:4000 root@<servidor>`
