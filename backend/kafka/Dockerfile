# Demo Kafka-like message broker (HTTP + SQLite).
# Build from the repository root:
#   docker build -f backend/kafka/Dockerfile -t triplanner/kafka .
FROM golang:1.23-alpine AS build

WORKDIR /src
COPY backend/kafka/go.mod backend/kafka/go.sum ./
RUN go mod download
COPY backend/kafka ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/broker ./cmd/broker

FROM alpine:3.20

RUN apk add --no-cache ca-certificates curl \
    && addgroup -S app \
    && adduser -S app -G app \
    && mkdir -p /data \
    && chown -R app:app /data

COPY --from=build /out/broker /usr/local/bin/broker

USER app
WORKDIR /app

ENV BROKER_ADDR=:8080 \
    BROKER_DB=/data/broker.db

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["broker"]
