# 0002 — Go demo broker + TripInvitation flow

| Field | Value |
|---|---|
| Status | Implemented and cluster-accepted (sink delivery; real Resend needs a recruiter key) |
| Integration branch | `refactor/helm` |
| Broker | `backend/kafka` (Go HTTP topic/offset/ack + SQLite) |
| Topic | `TripInvitation` (DLQ: `TripInvitation.dlq`) |
| Producer | API `sendTripInvite` |
| Consumer | `backend/email-service` |
| UI | Invited email preserved on the membership and shown with a demo badge |

## 1. Why this replaces the KafkaJS path

The first email slice used KafkaJS against a real Kafka-compatible broker.
KafkaJS only decodes gzip and needs consumer-group compatibility. I tested
Quafka (a Go Kafka broker): producing worked, but `createTopics` and consumer
groups failed with KafkaJS (`KafkaJSGroupCoordinatorNotFound`). A full Kafka
broker in Go that supports our TypeScript clients is not a realistic slice.

Decision: build a small **topic/offset/ack** broker in Go with an HTTP API.
It is not Apache Kafka wire-compatible; it is the demo’s async transport and
will move to gRPC later. The topic name stays `TripInvitation` so the product
flow is stable.

## 2. Topology

```
web -> api (sendTripInvite)
         └── POST /v1/topics/TripInvitation/messages
                    │
                    ▼
              triplanner-kafka (Go, SQLite)
                    │  long poll + ack
                    ▼
              email-service
                ├── Resend (BYOK key) or sink
                └── TripInvitation.dlq on terminal failure
```

The API still returns `code` + `joinUrl` immediately. If the broker is down,
the invitation remains usable through the copyable link; the publish failure is
logged without the recipient address.

## 3. Broker API

Base URL: `http://triplanner-kafka:8080`.

| Method | Path | Body / query |
|---|---|---|
| `POST` | `/v1/topics/{topic}/messages` | `{ "key": "...", "value": {...} }` |
| `GET` | `/v1/topics/{topic}/messages` | `consumer`, `limit` (1–100), `wait` (0–30s) |
| `POST` | `/v1/topics/{topic}/ack` | `{ "consumer": "...", "offset": 12 }` |
| `GET` | `/health`, `/ready` | — |

- Value must be valid JSON, max 1 MiB.
- Topic/consumer names: `[A-Za-z0-9._-]{1,128}`.
- Each consumer has an independent `next_offset`.
- Ack means “processed through this offset”; fetch starts at offset+1.
- At-least-once: a crash before ack replays the message. The email service
  deduplicates in-process and Resend deduplicates by event id for 24h.

## 4. Event envelope

The email service keeps its existing `email.invite.v1` type; the broker topic
is `TripInvitation`.

```json
{
  "id": "<invitation id>",
  "type": "email.invite.v1",
  "version": 1,
  "occurredAt": "2026-11-20T10:00:00.000Z",
  "source": "triplanner-api",
  "payload": {
    "to": "friend@example.com",
    "tripName": "Toronto 2026",
    "ownerName": "Demo",
    "code": "abcDEF123_-x",
    "joinUrl": "http://localhost:3000/join?...",
    "role": "viewer",
    "language": "es",
    "demo": true
  }
}
```

`ownerName` is the inviter’s display name (the current demo user). `demo` is
currently informational; the template always includes the demo notice.

## 5. Email template

Invitation copy:

- Subject: `<inviter> invited you to "<trip>" · demo`
- Heading: “You were invited to <trip>”
- Body: “<inviter> invited you to collaborate on this trip.”
- A demo panel: “Triplanner is running with demo users and no real
  authentication. If you accept, you will appear as a demo member.”
- Join button/link + invitation code.

Spanish/English mirror the existing layout; the recipient language comes from
the inviter’s `users.language` (default `es`).

## 6. Invitation acceptance and member display

- `trip_members.invited_email` is nullable and set when `joinTripWithCode`
  accepts an invitation.
- The existing `UPDATE users SET email = invitation.email` remains for demo
  compatibility; `invited_email` preserves the recruiter-entered address even
  if the demo user later edits their profile.
- `Member.invitedEmail` is exposed in GraphQL.
- `MembersPanel` displays `invitedEmail ?? email` and a small **Demo** badge
  when the membership came from an invitation.

## 7. Helm

The chart now deploys both workloads:

```yaml
images:
  broker: { name: marcojr13/triplanner-kafka, tag: "0.1.0" }
  email:  { name: marcojr13/triplanner-email, tag: "0.1.0" }

broker:
  enabled: true
  service: { port: 8080 }
  persistence: { enabled: true, size: 1Gi, mountPath: /data }

emailService:
  broker:
    url: http://triplanner-kafka:8080
    topic: TripInvitation
    consumer: email-service
    dlqTopic: TripInvitation.dlq
  persistence: { enabled: true, size: 1Gi, mountPath: /app/.data }
```

- Two PVCs: broker SQLite data and email BYOK settings.
- Both run as non-root with `runAsUser: 100`, `runAsGroup: 101` and
  `fsGroup: 101` (the Alpine app user); Kubernetes cannot verify a named,
  non-numeric image user without the numeric IDs.
- Templates are grouped by service:
  `templates/broker/broker-*.yaml` and `templates/email/email-*.yaml`; only
  `_helpers.tpl`, `NOTES.txt` and `serviceaccount.yaml` stay shared at the root.
- `triplanner-internal` Secret supplies `INTERNAL_TOKEN` for the BYOK API.
- The API deployment, when added, must receive `BROKER_URL`,
  `BROKER_TOPIC`, `EMAIL_SERVICE_URL` and the same `INTERNAL_TOKEN`.

## 8. Stages

| Stage | Status | Acceptance |
|---|---|---|
| M2c.1 Broker service | done | Go tests pass; container health/publish/fetch/ack smoke |
| M2c.2 API producer | done | `sendTripInvite` publishes; broker down leaves the copyable link |
| M2c.3 Email consumer | done | Long poll, ack, sink send, invalid event → DLQ |
| M2c.4 Invitation UX | done | Demo copy in template; `invitedEmail` + Demo badge in members |
| M2c.5 Helm broker | done | `helm lint` + `kubeconform` valid; both Deployments healthy |
| M2c.6 Cluster acceptance | done | rollout, `/ready`, sink invite, BYOK persistence and DLQ verified |
| M2c.7 gRPC migration | future | Replace HTTP client/server; preserve topic/offset/ack semantics |

## 9. Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | HTTP broker is not Kafka | Tooling/producers cannot use Kafka clients | Documented; gRPC migration next |
| R2 | SQLite single writer | Low throughput, one broker replica | Demo scope; one node; can move to Postgres later |
| R3 | No auth/TLS on broker | Internal cluster exposure | ClusterIP, NetworkPolicy opt-in, no ingress |
| R4 | At-least-once + polling | Duplicate sends on crash | Event id + Resend idempotency key |
| R5 | Single consumer offset per name | Scaling email replicas would compete | One replica; unique consumer name/gRPC later |
| R6 | `invited_email` is free text | UI display only; not auth | Membership checks still use user ids |
| R7 | API publishes after the DB write, not an outbox | Broker outage loses the event (link remains) | Log + copyable link; outbox is a follow-up |

## 10. Local evidence

- Go broker: `go test ./...` passes; container publish/fetch/ack smoke returns
  offsets and an empty fetch after ack.
- Email service: 63 tests pass; typecheck clean; local broker smoke logs
  `email.sent` and dead-letters an invalid event to `TripInvitation.dlq`.
- API: broker publisher test passes; end-to-end `sendTripInvite` publishes and
  the email service consumes it.
- Member display: `joinTripWithCode` returns `invitedEmail: friend@example.com`
  for the demo-friend membership.
- Helm: 8 resources valid under `kubeconform -strict`.
- Cluster acceptance on Docker Desktop (`desktop-control-plane`):
  - both Deployments `1/1` with bound PVCs
  - `helm test` succeeded
  - `/ready` returned `provider=sink, brokerReady=true`
  - a `TripInvitation` event produced `email.sent`
  - BYOK: saved a Resend key, response had no key, `/ready` stayed true, a pod
    restart reloaded `provider=resend/hasKey=true`, then `clearKey` returned
    `provider=sink/hasKey=false`
  - an invalid event produced one `TripInvitation.dlq` record
