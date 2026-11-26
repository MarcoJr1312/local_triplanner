# Triplanner email service

HTTP consumer for the Go demo broker. It renders and delivers Triplanner
email; the API and the trips service publish `TripInvitation` messages and keep
serving the copyable join link when email is disabled.

- Runtime: Bun + TypeScript
- Broker: `backend/kafka` (Go, HTTP topic/offset/ack + SQLite)
- Provider: Resend (direct `fetch`, no SDK) or `sink` for local/demo
- Topic: `TripInvitation`; DLQ: `TripInvitation.dlq`
- Events: `email.invite.v1`, `email.reminder.v1`, `email.verification.v1`,
  `email.welcome.v1`, `email.member.joined.v1`
- Probes: `GET /health`, `GET /ready` on `HEALTH_PORT` (default `4200`)
- BYOK settings: `GET/POST /api/email/config` on the same port

## Flow

```
API sendTripInvite
  -> POST /v1/topics/TripInvitation/messages
      -> email-service long-polls GET ...?consumer=email-service&wait=20
      -> validate -> render es/en
      -> Resend (Idempotency-Key = event id) or sink
      -> POST .../ack {offset}
      -> terminal failure: POST TripInvitation.dlq/messages, then ack
```

Delivery is at-least-once. A message is acknowledged only after a send,
duplicate skip, or successful DLQ publish; a crash replays it and Resend
deduplicates by event id.

## Local run

1. Start the Go broker:

```bash
cd backend/kafka
docker build -f backend/kafka/Dockerfile -t triplanner/kafka .
docker run --rm -p 8080:8080 -v triplanner-kafka-data:/data triplanner/kafka
```

2. Run the email service:

```bash
cd backend/email-service
cp .env.example .env
bun install
bun run start
```

`.env.example` uses `EMAIL_PROVIDER=sink`, so no Resend key is needed.

3. Publish a sample message:

```bash
curl -X POST http://localhost:8080/v1/topics/TripInvitation/messages \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "evt-demo-1",
    "value": {
      "id": "evt-demo-1",
      "type": "email.invite.v1",
      "version": 1,
      "occurredAt": "2026-11-20T10:00:00.000Z",
      "source": "triplanner-api",
      "payload": {
        "to": "friend@example.com",
        "tripName": "Toronto 2026",
        "ownerName": "DemoUser",
        "code": "abcDEF123_-x",
        "joinUrl": "http://localhost:3000/join?trip=t1&code=abcDEF123_-x",
        "role": "viewer",
        "language": "es"
      }
    }
  }'
```

The service logs `email.sent` (and `email.sink.drop` when provider is sink)
without the full recipient address.

## Commands

```bash
bun test
bunx tsc --noEmit
docker build -f backend/email-service/Dockerfile -t triplanner/email-service .
```

Tests cover the envelope contract, both template languages, the retry/DLQ
policy, Resend error classification, config validation, broker client and BYOK
settings.

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
service is internal; the endpoint is protected by the shared `INTERNAL_TOKEN`.

## Configuration

| Variable | Default | Secret | Notes |
|---|---|---|---|
| `BROKER_URL` | `http://127.0.0.1:8080` | no | Go broker base URL |
| `BROKER_TOPIC` | `TripInvitation` | no | Request topic |
| `BROKER_CONSUMER` | `email-service` | no | Offset key |
| `BROKER_DLQ_TOPIC` | `<topic>.dlq` | no | Dead-letter topic |
| `BROKER_BATCH_SIZE` | `10` | no | Messages per fetch |
| `BROKER_WAIT_SECONDS` | `20` | no | Long-poll seconds (0–30) |
| `BROKER_REQUEST_TIMEOUT_MS` | `35000` | no | Must exceed wait |
| `BROKER_RETRY_DELAY_MS` | `1000` | no | Backoff after broker errors |
| `EMAIL_PROVIDER` | `resend` | no | Env default; runtime override wins |
| `RESEND_API_KEY` | — | yes | Optional seed; BYOK key lives on the PVC |
| `RESEND_FROM` | `Triplanner <onboarding@resend.dev>` | no | Verified sender |
| `RESEND_REPLY_TO` | — | no | Optional reply-to |
| `RESEND_ENDPOINT` | `https://api.resend.com/emails` | no | Provider endpoint |
| `RESEND_TIMEOUT_MS` | `10000` | no | Provider request timeout |
| `EMAIL_MAX_ATTEMPTS` | `5` | no | Per-message retry budget |
| `EMAIL_RETRY_BASE_MS` | `500` | no | Retry backoff base |
| `INTERNAL_TOKEN` | `dev-internal-token` | yes | Protects the settings API |
| `EMAIL_SETTINGS_FILE` | `.data/email.json` | no | BYOK override path |
| `APP_URL` | `http://localhost:3000` | no | Welcome CTA |
| `HEALTH_PORT` | `4200` | no | Probe port |

`EMAIL_PROVIDER` defaults to `resend` on purpose: a production deployment must
not silently drop mail. Local/demo environments set `sink` explicitly; the
recruiter switches to `resend` from the app after saving a key.
