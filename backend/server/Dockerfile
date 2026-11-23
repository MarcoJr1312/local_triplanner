# Build from the repository root:
#   docker build -f backend/server/Dockerfile -t triplanner/api .
FROM oven/bun:1.4.3-alpine

RUN apk upgrade --no-cache \
    && apk add --no-cache curl \
    && addgroup -S app \
    && adduser -S app -G app

WORKDIR /app

COPY backend/server/package.json backend/server/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY backend/server/src ./src
# gRPC contracts, resolved through PROTO_ROOT.
COPY proto ./proto
# db:migrate / db:seed resolve ../../db relative to src.
COPY backend/db/pg ./db/pg
COPY backend/db/seed-data.json ./db/seed-data.json
COPY backend/db/toronto-locations.json ./db/toronto-locations.json
COPY backend/db/seed-images ./db/seed-images
# schema.graphql lives next to src in the image.
COPY backend/graphql ./graphql

RUN mkdir -p /app/uploads && chown -R app:app /app

ENV NODE_ENV=production
ENV PROTO_ROOT=/app/proto
USER app
EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=3s --start-period=45s --retries=12 \
  CMD curl -f http://localhost:4000/health || exit 1

# CMD (not ENTRYPOINT) so Compose can run migrations/seed first.
CMD ["bun", "src/index.ts"]
