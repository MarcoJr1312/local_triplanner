# Build from the repository root:
#   docker build -f backend/locations-service/Dockerfile -t triplanner/locations-service .
FROM oven/bun:1.4.3-alpine

RUN apk upgrade --no-cache \
    && apk add --no-cache curl \
    && addgroup -S app \
    && adduser -S app -G app

WORKDIR /app

COPY backend/locations-service/package.json backend/locations-service/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY backend/locations-service/src ./src
COPY backend/db/toronto-locations.json ./db/toronto-locations.json

RUN mkdir -p /app/.data && chown -R app:app /app

ENV NODE_ENV=production
ENV SETTINGS_FILE=/app/.data/locations.json
USER app
EXPOSE 4300

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD sh -c 'curl -f "http://localhost:${PORT:-4300}/ready" || exit 1'

CMD ["bun", "src/index.ts"]
