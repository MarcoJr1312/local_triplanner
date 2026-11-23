# Build from the repository root:
#   docker build -f backend/trips-service/Dockerfile -t triplanner/trips-service .
FROM oven/bun:1.4.3-alpine

RUN apk upgrade --no-cache \
    && apk add --no-cache curl \
    && addgroup -S app \
    && adduser -S app -G app

WORKDIR /app

COPY backend/trips-service/package.json backend/trips-service/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY backend/trips-service/src ./src
COPY backend/trips-service/db ./db
COPY backend/trips-service/scripts ./scripts
# gRPC contract, resolved through PROTO_PATH.
COPY proto ./proto

RUN chown -R app:app /app

ENV NODE_ENV=production
ENV PROTO_PATH=/app/proto/triplanner/trips/v1/trips.proto
ENV HEALTH_PROTO_PATH=/app/proto/grpc/health/v1/health.proto
USER app
EXPOSE 4400
EXPOSE 50052

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD sh -c 'curl -f "http://localhost:${PORT:-4400}/ready" || exit 1'

CMD ["bun", "src/index.ts"]
