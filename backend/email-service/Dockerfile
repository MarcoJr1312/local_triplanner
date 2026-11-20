# Build from the repository root:
#   docker build -f backend/email-service/Dockerfile -t triplanner/email-service .
FROM oven/bun:1.4.3-alpine

RUN apk upgrade --no-cache \
    && apk add --no-cache curl \
    && addgroup -S app \
    && adduser -S app -G app

WORKDIR /app

COPY backend/email-service/package.json backend/email-service/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY backend/email-service/src ./src

RUN chown -R app:app /app

ENV NODE_ENV=production
USER app
EXPOSE 4200

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD curl -f http://localhost:4200/health || exit 1

CMD ["bun", "src/index.ts"]
