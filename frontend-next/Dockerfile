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
RUN apk add --no-cache curl
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
