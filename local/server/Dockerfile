# Build from the repository root:
#   docker build -f local/server/Dockerfile -t triplanner/api .
FROM oven/bun:1.4.3-alpine

# curl is required by the container health check.
RUN apk add --no-cache curl

WORKDIR /app

COPY local/server/package.json local/server/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY local/server/src ./src
# db:migrate / db:seed resolve ../../db relative to src.
COPY local/db/pg ./db/pg
COPY local/db/seed-data.json ./db/seed-data.json
# schema.graphql lives next to src in the image.
COPY local/graphql ./graphql

ENV NODE_ENV=production
EXPOSE 4000

# CMD (not ENTRYPOINT) so a compose init job can override it with
# `bun run db:migrate` / `bun run db:seed`.
CMD ["bun", "src/index.ts"]
