# Triplanner Kafka-like broker

A small, durable message broker written in Go. It exposes an HTTP topic API for
the demo, with **publish**, **consume from a per-consumer offset** and **ack**.
It is intentionally not the Apache Kafka wire protocol; the API was chosen so
the Go service is simple to test and run, and can later be replaced by gRPC.

```
API producer ──POST /v1/topics/TripInvitation/messages──> broker (SQLite)
                                                             │
email service ──GET ...?consumer=email-service&wait=20───────┘
             ──POST .../ack {offset}──────────────────────────┘
```

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | SQLite readiness |
| `POST` | `/v1/topics/{topic}/messages` | Publish `{ "key": "...", "value": {...} }` |
| `GET` | `/v1/topics/{topic}/messages?consumer=...&limit=10&wait=20` | Fetch messages after the consumer's offset; `wait` long-polls up to 30s |
| `POST` | `/v1/topics/{topic}/ack` | Ack `{ "consumer": "...", "offset": 12 }` (processed through 12) |

- Topic/consumer names: `[A-Za-z0-9._-]{1,128}`.
- Message value must be valid JSON, max 1 MiB.
- Delivery is at-least-once: the offset moves only when the consumer acks.
- Each consumer has an independent offset.
- `TripInvitation.dlq` is just another topic; the email service publishes there
  when a message is terminally invalid.

## Run

```bash
cd backend/kafka
go test ./...
go run ./cmd/broker
# or
docker build -f backend/kafka/Dockerfile -t triplanner/kafka .
docker run --rm -p 8080:8080 -v kafka-data:/data triplanner/kafka
```

Environment:

| Variable | Default | |
|---|---|---|
| `BROKER_ADDR` | `:8080` | HTTP listen address |
| `BROKER_DB` | `/data/broker.db` | SQLite path; the directory is created |

## Scope

Single-node, no auth, no TLS, no replication. It is the `broker A` demo
implementation; a gRPC protocol is the next migration. Do not use it as a
general-purpose Kafka replacement.
