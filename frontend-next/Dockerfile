# Build from the repository root:
#   docker build -f frontend-next/Dockerfile -t triplanner/web .
FROM oven/bun:1.4.3-alpine AS deps
WORKDIR /app
COPY frontend-next/package.json frontend-next/bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.4.3-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY frontend-next/ ./
RUN bun run build

FROM node:22-alpine AS runner
# Node is the only runtime needed; dropping npm/corepack removes their
# bundled dependency tree from the shipped image.
RUN apk upgrade --no-cache \
    && apk add --no-cache curl \
    && rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/bin/npm \
              /usr/local/bin/npx \
              /usr/local/bin/corepack
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=45s --retries=12 \
  CMD curl -f http://localhost:3000/login || exit 1

CMD ["node", "server.js"]
