# Build from the repository root:
#   docker build -f backend/users-service/Dockerfile -t triplanner/users-service .
FROM oven/bun:1.4.3-alpine

RUN apk upgrade --no-cache \
    && apk add --no-cache curl \
    && addgroup -S app \
    && adduser -S app -G app

WORKDIR /app

COPY backend/users-service/package.json backend/users-service/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY backend/users-service/src ./src
COPY backend/users-service/db ./db
COPY backend/users-service/scripts ./scripts
# gRPC contract, resolved through PROTO_PATH.
COPY proto ./proto

RUN chown -R app:app /app

ENV NODE_ENV=production
ENV PROTO_PATH=/app/proto/triplanner/users/v1/users.proto
USER app
EXPOSE 4500
EXPOSE 50051

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD sh -c 'curl -f "http://localhost:${PORT:-4500}/ready" || exit 1'

CMD ["bun", "src/index.ts"]
