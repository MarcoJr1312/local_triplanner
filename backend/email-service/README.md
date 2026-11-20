# Triplanner email service

Kafka-driven email microservice. It is the only component that renders and
delivers Triplanner email; the API publishes events and keeps serving the
copyable join link when email is disabled.

- Runtime: Bun + TypeScript, `kafkajs`
- Provider: Resend (direct `fetch`, no SDK) or `sink` for local/demo
- Contract: `triplanner.email.requests.v1` (see `docs/migrations/0001-email-service.md`)
- Probes: `GET /health`, `GET /ready` on `HEALTH_PORT` (default `4200`)

## Event flow

```
API / outbox relay
    -> triplanner.email.requests.v1
        -> validate envelope
        -> render es/en template
        -> Resend (Idempotency-Key = event id)
        -> retry transient failures (429, 5xx, network, 409 concurrent)
        -> triplanner.email.requests.v1.dlq (invalid / exhausted)
```

Delivery is at-least-once. The consumer commits an offset after the handler
resolves; Resend deduplicates retries with the event id for 24 hours.

## Local run

1. Start a single-node Kafka (Redpanda is the smallest option):

```bash
docker run -d --name redpanda -p 9092:9092 \
  redpandadata/redpanda:v24.2.18 \
  redpanda start --overprovisioned --smp 1 --memory 1G --reserve-memory 0M \
  --node-id 0 --check=false \
  --kafka-addr PLAINTEXT://0.0.0.0:29092,OUTSIDE://0.0.0.0:9092 \
  --advertise-kafka-addr PLAINTEXT://localhost:29092,OUTSIDE://localhost:9092
```

2. Configure and run the service:

```bash
cd backend/email-service
cp .env.example .env
bun install
bun run start
```

`.env.example` uses `EMAIL_PROVIDER=sink` and `KAFKA_ENSURE_TOPICS=true`, so no
Resend key is needed and the request/DLQ topics are created on first boot.

3. Publish a sample event:

```bash
printf '%s\n' '{
  "id": "evt-demo-1",
  "type": "email.invite.v1",
  "version": 1,
  "occurredAt": "2026-11-19T10:00:00.000Z",
  "source": "manual",
  "payload": {
    "to": "friend@example.com",
    "tripName": "Toronto 2026",
    "ownerName": "Marco",
    "code": "abcDEF123_-x",
    "joinUrl": "http://localhost:3000/join?trip=t1&code=abcDEF123_-x",
    "role": "viewer",
    "language": "es"
  }
}' | docker exec -i redpanda rpk topic produce triplanner.email.requests.v1 -k evt-demo-1 -z gzip
```

> **Compression:** KafkaJS 2.2.x only decodes gzip. Every producer must use
> `gzip` (or no compression); `snappy`, `lz4` and `zstd` batches crash the
> consumer. The topic config also sets `compression.type=gzip`, and the API
> outbox relay must send `CompressionTypes.GZIP`. This is a client limitation,
> tracked as an open decision in the migration doc.

The service logs `email.sent` and the sink provider logs `email.sink.drop`
without the full recipient address.

## Commands

```bash
bun test
bunx tsc --noEmit
docker build -f backend/email-service/Dockerfile -t triplanner/email-service .
```

Tests cover the envelope contract, both template languages, the retry/DLQ
policy, Resend error classification, config validation and the BYOK settings
store/HTTP API. A Kafka integration smoke test is documented in
`docs/migrations/0001-email-service.md`.

## BYOK settings (recruiter-supplied key)

The recruiter can switch from `sink` to Resend from the app; no key is baked
into the image or chart. The service exposes a small internal API:

```http
GET  /api/email/config
POST /api/email/config    X-Internal-Token: <INTERNAL_TOKEN>
```

`GET` returns `{provider, from, replyTo, hasKey, ready}` and never the key.
`POST` accepts `{provider, apiKey, from, replyTo, clearKey}` and persists the
runtime override at `EMAIL_SETTINGS_FILE` (default `.data/email.json`, mode
`0600`). Precedence is **runtime override > env**. A key supplied only by env
is not copied to disk; clearing the key while on Resend is rejected.

The API proxies this endpoint through GraphQL (`getEmailSettings` /
`updateEmailSettings`) and the Profile modal renders the form. The email
service must be reachable only by the API pod; the endpoint is protected by the
shared `INTERNAL_TOKEN`.

## Configuration

Every variable maps to a Helm value; the full table lives in the migration doc.
The important ones:

| Variable | Default | Secret | Notes |
|---|---|---|---|
| `KAFKA_BROKERS` | — | no | Comma-separated bootstrap servers |
| `KAFKA_TOPIC` | `triplanner.email.requests.v1` | no | Request topic |
| `KAFKA_DLQ_TOPIC` | `<topic>.dlq` | no | Dead-letter topic |
| `KAFKA_GROUP_ID` | `triplanner-email-service` | no | Consumer group |
| `KAFKA_SSL` | `false` | no | Enable TLS |
| `KAFKA_SASL_MECHANISM` | — | no | `plain`, `scram-sha-256`, `scram-sha-512` |
| `KAFKA_SASL_USERNAME` | — | yes | From a Kubernetes Secret |
| `KAFKA_SASL_PASSWORD` | — | yes | From a Kubernetes Secret |
| `EMAIL_PROVIDER` | `resend` | no | Env default; runtime override wins |
| `RESEND_API_KEY` | — | yes | Optional seed; BYOK key lives on the PVC |
| `RESEND_FROM` | `Triplanner <onboarding@resend.dev>` | no | Verified sender |
| `RESEND_REPLY_TO` | — | no | Optional reply-to |
| `EMAIL_MAX_ATTEMPTS` | `5` | no | Per-message retry budget |
| `INTERNAL_TOKEN` | `dev-internal-token` | yes | Protects the settings API |
| `EMAIL_SETTINGS_FILE` | `.data/email.json` | no | BYOK override path |
| `HEALTH_PORT` | `4200` | no | Probe port |

`EMAIL_PROVIDER` defaults to `resend` on purpose: a production deployment must
not silently drop mail. Local/demo environments set `sink` explicitly; the
recruiter switches to `resend` from the app after saving a key.
