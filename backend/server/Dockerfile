# Build from the repository root:
#   docker build -f backend/server/Dockerfile -t triplanner/api .
FROM oven/bun:1.4.3-alpine

# curl is required by the container health check.
RUN apk add --no-cache curl

WORKDIR /app

COPY backend/server/package.json backend/server/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY backend/server/src ./src
# db:migrate / db:seed resolve ../../db relative to src.
COPY backend/db/pg ./db/pg
COPY backend/db/seed-data.json ./db/seed-data.json
COPY backend/db/toronto-locations.json ./db/toronto-locations.json
COPY backend/db/seed-images ./db/seed-images
# schema.graphql lives next to src in the image.
COPY backend/graphql ./graphql

ENV NODE_ENV=production
EXPOSE 4000

# CMD (not ENTRYPOINT) so a compose init job can override it with
# `bun run db:migrate` / `bun run db:seed`.
CMD ["bun", "src/index.ts"]
