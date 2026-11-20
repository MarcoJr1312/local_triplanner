# 0001 — Email microservice (Resend over Kafka)

| Field | Value |
|---|---|
| Status | M1 complete; M2 next |
| Integration branch | `refactor/helm` |
| Work branch | `refactor/helm-email-service` (local only) |
| Backend owner | agent |
| Helm/infra owner | Marco |
| Provider | Resend, optional (`EMAIL_PROVIDER=sink` for local) |
| Broker | Kafka, provider-agnostic (Strimzi, Redpanda, MSK, Confluent…) |

## 1. Summary

Extract email delivery from the API into a stateless `email-service` that
consumes a versioned Kafka topic. The API keeps ownership of invitations and
reminders; it publishes an event instead of calling Resend.

The recruiter demo must not regress: with `EMAIL_MODE=disabled` (default) the
API writes no events, no Kafka or Resend account is needed, and the invitation
modal still returns a copyable join link. Email is an opt-in deployment mode.

**BYOK:** when the recruiter does want real delivery, they add their own Resend
key from the app (same pattern as the LLM settings). No email key is shipped in
the chart or required at install time; the runtime override lives on a PVC.

This is the first extraction and also the reference implementation for the
playbook in `docs/migrations/README.md`.

## 2. Current state

- Resend was removed from the monolith in `0d042e9`. The old `email.ts`
  (templates, Resend client) is recoverable from `0d042e9^` and has been ported
  into `backend/email-service`.
- `sendTripInvite` creates the invitation and returns `code` + `joinUrl`; the UI
  shows the copyable link.
- Reminder scheduling exists but the sweep is disabled (no provider).
- There is no Kafka in the repo yet. The Helm chart is still the scaffold.
- `backend/email-service` is new, independently runnable, and has 43 unit tests.

## 3. Scope

**In scope**

- `backend/email-service`: Kafka consumer, es/en templates, Resend adapter,
  retries, DLQ, probes, non-root image.
- Versioned event contract and topic names.
- API producer via a Postgres outbox (M2).
- Invitation emails first; reminder emails second (M3).
- Helm values contract for the service and shared Kafka settings.

**Out of scope**

- Moving Postgres/Mongo or splitting the GraphQL API.
- Replacing demo auth.
- Wiring verification/welcome producers (templates exist, no flow currently
  triggers them).
- Per-service databases, service mesh, distributed tracing.
- Automatic DLQ replay.

## 4. Target topology

```
web ──> api (GraphQL, Bun)
          ├── Postgres: invitations + email_outbox (same transaction)
          ├── Mongo: catalogue
          └── outbox relay ──> Kafka topic triplanner.email.requests.v1
                                      │
                                      ▼
                              email-service (1 replica on the recruiter node)
                                      ├── Resend (HTTPS 443)
                                      └── DLQ topic triplanner.email.requests.v1.dlq
```

The email service has no database. Its only state is the Kafka consumer group
and a bounded in-memory dedupe cache.

## 5. Event contract

### 5.1 Topic and message key

| Item | Value |
|---|---|
| Request topic | `triplanner.email.requests.v1` |
| DLQ topic | `triplanner.email.requests.v1.dlq` |
| Consumer group | `triplanner-email-service` |
| Key | Event id (UUID), for even spread; ordering is not required |
| Compression | **gzip or none** — see risk R1 |
| Retention | Requests 7 days; DLQ 30 days |

Headers are advisory and may be used for routing/observability; the JSON
envelope is authoritative:

```
event-id: <uuid>
event-type: email.invite.v1
schema-version: 1
source: triplanner-api
```

### 5.2 Envelope

```json
{
  "id": "6f1c2a4e-6d0f-4a4e-9f6f-2f4a1c9b7e21",
  "type": "email.invite.v1",
  "version": 1,
  "occurredAt": "2026-11-19T10:00:00.000Z",
  "source": "triplanner-api",
  "payload": {
    "to": "friend@example.com",
    "tripName": "Toronto 2026",
    "ownerName": "Marco",
    "code": "abcDEF123_-x",
    "joinUrl": "http://localhost:3000/join?trip=t1&code=abcDEF123_-x",
    "role": "viewer",
    "language": "es"
  }
}
```

Rules:

- `id` is globally unique and stable across retries. The outbox row id is the
  event id and the Resend idempotency key.
- `type` is a versioned event name. Additive fields are allowed within a
  version; breaking changes use a new type (`email.invite.v2`) and a new topic
  (`...v2`), never a silent mutation.
- Unknown `type`/`version`, invalid email/URL/day/time, or an unsupported role
  is **non-retryable** and goes to the DLQ.
- Max message size is the broker default (1 MB); templates are rendered in the
  service, so payloads stay small.

### 5.3 Event types

| Type | Payload | Producer |
|---|---|---|
| `email.invite.v1` | `to, tripName, ownerName, code, joinUrl, role?, language?` | `sendTripInvite` (M2) |
| `email.reminder.v1` | `to, tripName, itemTitle, day, startTime, language?` | reminder sweep (M3) |
| `email.verification.v1` | `to, link, name?, language?` | future auth flow |
| `email.welcome.v1` | `to, name, language?` | future onboarding |

`language` is `es` (default) or `en`. Unknown values normalize to `es`.

## 6. Delivery semantics

At-least-once, with an explicit idempotency boundary:

1. `eachMessage` parses and handles the event.
2. The offset is committed after the handler resolves.
3. A crash between Resend accepting the email and the commit can redeliver.
4. Resend receives `Idempotency-Key: <event id>`, so a retry within 24 hours
   returns the original response instead of sending twice.
5. A bounded in-memory cache catches redeliveries within one pod; it is not the
   cross-replica guarantee.

| Failure | Classification | Action |
|---|---|---|
| Network error, timeout | Retryable | Exponential backoff, max `EMAIL_MAX_ATTEMPTS` |
| HTTP 429 | Retryable | Backoff, honour provider limits |
| HTTP 5xx | Retryable | Backoff |
| HTTP 409 `concurrent_idempotent_requests` | Retryable | Retry later |
| HTTP 400/401/403/404/422 | Terminal | DLQ |
| HTTP 409 `invalid_idempotent_request` | Terminal | DLQ (key reused with a different payload) |
| Invalid envelope / unsupported type | Terminal | DLQ without provider call |
| Render failure | Terminal | DLQ |
| Retries exhausted | Terminal | DLQ |

Backoff: `min(base * 2^(attempt-1), 30s)` with +/-20% jitter. No unbounded
retries. A DLQ publish failure is thrown so the offset is not committed; the
message is redelivered.

Ordering is not guaranteed and not needed. Each event is independent; a
reminder may overtake an invitation.

## 7. Producer design (API, M2)

### 7.1 Outbox, not dual write

The API must not write Postgres and publish to Kafka as two independent steps.
Add `email_outbox` to `backend/db/pg/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS email_outbox_pending_idx
  ON email_outbox (status, available_at)
  WHERE status = 'pending';
```

`payload` is the full envelope, so the relay publishes it unchanged.

### 7.2 Invitation transaction

```ts
const invitation = await db.transaction(async (tx) => {
  const row = await createInvitation(tx, { tripId, email, role, createdBy });
  await enqueueEmail(tx, {
    id: randomUUID(),
    type: 'email.invite.v1',
    version: 1,
    occurredAt: new Date().toISOString(),
    source: 'triplanner-api',
    payload: {
      to: row.email,
      tripName: trip.name,
      ownerName,
      code: row.code,
      joinUrl: buildJoinUrl(tripId, row.code),
      role: row.role,
      language: ownerLanguage,
    },
  });
  return row;
});
```

The GraphQL response still returns `code` and `joinUrl`. Publishing is not on
the request path; a Kafka outage cannot fail an invitation.

### 7.3 Relay

A single loop in the API (safe with multiple API replicas):

```sql
SELECT id, payload FROM email_outbox
WHERE status = 'pending' AND available_at <= now()
ORDER BY created_at
LIMIT $1
FOR UPDATE SKIP LOCKED;
```

- Publish with key = `id`, `CompressionTypes.GZIP`.
- Mark `sent`, set `sent_at`.
- On failure: `attempts = attempts + 1`, `last_error`, backoff; after 10
  attempts mark `failed` and alert. A failed row is replayed by an operator.
- Delete `sent` rows after 7 days (cron/job), keeping the table bounded.

### 7.4 Flags

| Flag | Default | Behaviour |
|---|---|---|
| `EMAIL_MODE=disabled` | yes | No outbox write; current copyable-link behaviour |
| `EMAIL_MODE=outbox` | — | Invitation write + outbox row in one transaction; relay publishes |
| `REMINDERS_ENABLED=0` | yes | No sweep |
| `REMINDERS_ENABLED=1` | — | Sweep enqueues reminder events; requires M3 transaction change |

There is deliberately no `direct` publish mode: it would reintroduce the dual
write this design removes.

### 7.5 Reminders (M3)

The current `sweepOnce` marks `reminder_sent = 1` even after a sender failure.
For the outbox, that rule is wrong: the sweep must insert all recipient events
and set `reminder_sent` in one transaction. If the insert fails, the item stays
eligible. Keep `REMINDERS_ENABLED=0` until that change and its tests land.

## 8. Email service design

```
src/
  config.ts        env parsing, no secrets in errors
  events.ts        envelope validation, PII redaction
  handler.ts       validate -> render -> send -> retry/DLQ policy
  idempotency.ts   bounded in-memory cache
  consumer.ts      KafkaJS adapter, DLQ producer, readiness
  settings.ts      BYOK runtime overrides on the PVC (0600)
  providers/       Resend (fetch), sink (local), provider router
  health.ts        /health, /ready, /api/email/config
  templates/       es/en HTML + text, shared layout
```

- No database and no public inbound API. The only non-probe endpoint is the
  `INTERNAL_TOKEN`-protected settings API used by the GraphQL proxy.
- `GET /health` is always 200 while the process lives.
- `GET /ready` is 503 until the consumer joins the group and the **current**
  provider is configured. Changing the provider/key from the app is reflected
  without a restart.
- SIGTERM stops the consumer, disconnects the DLQ producer and exits within
  `SHUTDOWN_TIMEOUT_MS`.
- A non-retriable consumer crash exits with code 1 so Kubernetes restarts the
  pod instead of silently staying unready. A poison batch can crash-loop; see
  R1 and the DLQ runbook.

## 9. Configuration and Helm values

### 9.1 Environment contract

| Env var | Required | Default | Secret | Helm value |
|---|---|---|---|---|
| `KAFKA_BROKERS` | yes | — | no | `kafka.brokers` (join with commas) |
| `KAFKA_CLIENT_ID` | no | `triplanner-email-service` | no | `emailService.kafka.clientId` |
| `KAFKA_GROUP_ID` | no | `triplanner-email-service` | no | `emailService.kafka.groupId` |
| `KAFKA_TOPIC` | no | `triplanner.email.requests.v1` | no | `emailService.kafka.topic` |
| `KAFKA_DLQ_TOPIC` | no | `<topic>.dlq` | no | `emailService.kafka.dlqTopic` |
| `KAFKA_SSL` | no | `false` | no | `kafka.tls.enabled` |
| `KAFKA_SSL_CA_PATH` | no | — | mount | `kafka.tls.mountPath` |
| `KAFKA_SSL_REJECT_UNAUTHORIZED` | no | `true` | no | `kafka.tls.rejectUnauthorized` |
| `KAFKA_SASL_MECHANISM` | no | — | no | `kafka.sasl.mechanism` |
| `KAFKA_SASL_USERNAME` | with SASL | — | yes | `kafka.sasl.existingSecret` |
| `KAFKA_SASL_PASSWORD` | with SASL | — | yes | `kafka.sasl.existingSecret` |
| `KAFKA_ENSURE_TOPICS` | no | `false` | no | `emailService.kafka.ensureTopics` |
| `KAFKA_PARTITIONS` | no | `3` | no | `emailService.kafka.partitions` |
| `KAFKA_REPLICATION_FACTOR` | no | `1` | no | `emailService.kafka.replicationFactor` |
| `KAFKA_CONCURRENCY` | no | `3` | no | `emailService.kafka.concurrency` |
| `KAFKA_CONNECTION_TIMEOUT_MS` | no | `10000` | no | `emailService.kafka.connectionTimeoutMs` |
| `KAFKA_REQUEST_TIMEOUT_MS` | no | `30000` | no | `emailService.kafka.requestTimeoutMs` |
| `EMAIL_PROVIDER` | no | `resend` | no | `emailService.provider` |
| `RESEND_API_KEY` | if Resend | — | yes | `emailService.resend.existingSecret` |
| `RESEND_FROM` | no | `Triplanner <onboarding@resend.dev>` | no | `emailService.resend.from` |
| `RESEND_REPLY_TO` | no | — | no | `emailService.resend.replyTo` |
| `RESEND_ENDPOINT` | no | `https://api.resend.com/emails` | no | `emailService.resend.endpoint` |
| `RESEND_TIMEOUT_MS` | no | `10000` | no | `emailService.resend.timeoutMs` |
| `EMAIL_MAX_ATTEMPTS` | no | `5` | no | `emailService.retry.maxAttempts` |
| `EMAIL_RETRY_BASE_MS` | no | `500` | no | `emailService.retry.baseDelayMs` |
| `APP_URL` | no | `http://localhost:3000` | no | `global.appUrl` |
| `INTERNAL_TOKEN` | yes for config API | `dev-internal-token` | yes | `emailService.internalToken` |
| `EMAIL_SETTINGS_FILE` | no | `.data/email.json` | no | `emailService.settingsFile` |
| `HEALTH_PORT` | no | `4200` | no | `emailService.containerPort` |
| `LOG_LEVEL` | no | `info` | no | `emailService.logLevel` |
| `SHUTDOWN_TIMEOUT_MS` | no | `15000` | no | `emailService.shutdownTimeoutMs` |

API producer (M2):

| Env var | Default | Helm value |
|---|---|---|
| `EMAIL_MODE` | `disabled` | `api.email.mode` |
| `EMAIL_OUTBOX_POLL_MS` | `1000` | `api.email.outboxPollMs` |
| `EMAIL_OUTBOX_BATCH_SIZE` | `50` | `api.email.outboxBatchSize` |
| `EMAIL_SERVICE_URL` | `http://127.0.0.1:4200` | `api.email.serviceUrl` |
| `REMINDERS_ENABLED` | `0` | `api.reminders.enabled` |

`EMAIL_PROVIDER` defaults to `resend` in the service code to avoid silently
dropping mail in a production deployment. The recruiter Helm profile sets
`provider: sink` explicitly; the recruiter switches to Resend from the app,
which writes the runtime override (see 9.7).

### 9.2 values.yaml contract

The primary target is a **single-node recruiter install**: the recruiter's
computer is the Kubernetes node, every workload runs one replica, and there is
no high-availability assumption. A hosted/HA profile is shown afterwards for
completeness; it is not the default.

#### 9.2.1 Recruiter single-node profile (default)

```yaml
global:
  # This must be the URL the recruiter actually opens. With
  # `kubectl port-forward svc/web 3000:3000` that is localhost:3000.
  # For a NodePort use http://localhost:30080 (or the chosen port).
  # For an Ingress use its host. Do not use a fake example.com domain.
  appUrl: http://localhost:3000

kafka:
  brokers:
    - kafka:9092              # in-cluster single broker (Redpanda/Strimzi)
  tls:
    enabled: false            # local single node: plaintext inside the pod network
  sasl:
    enabled: false

emailService:
  enabled: true
  image:
    repository: marcojr13/triplanner-email
    tag: "0.1.0"
    pullPolicy: IfNotPresent
  replicaCount: 1
  containerPort: 4200

  # The API proxies get/updateEmailSettings to this Service. Internal only.
  service:
    enabled: true
    type: ClusterIP
    port: 4200

  # Key-free demo: the pipeline runs, messages are logged and dropped. The
  # recruiter can switch to Resend from the app (BYOK); no Secret is required
  # at install time.
  provider: sink
  logLevel: info
  shutdownTimeoutMs: 15000

  # Runtime BYOK override (provider, key, from, reply-to). Stored 0600 on the
  # PVC so it survives pod restarts. See 9.7.
  settingsFile: /app/.data/email.json
  persistence:
    enabled: true
    size: 1Gi
    existingClaim: ""
    mountPath: /app/.data
  internalToken:
    existingSecret: triplanner-internal
    key: INTERNAL_TOKEN

  kafka:
    clientId: triplanner-email-service
    groupId: triplanner-email-service
    topic: triplanner.email.requests.v1
    dlqTopic: triplanner.email.requests.v1.dlq
    # Single-node demo: let the service create both topics on first boot.
    # Set false and create KafkaTopic resources if the chart owns topics.
    ensureTopics: true
    partitions: 3
    replicationFactor: 1
    concurrency: 3
    connectionTimeoutMs: 10000
    requestTimeoutMs: 30000

  resend:
    from: "Triplanner <onboarding@resend.dev>"
    replyTo: ""
    endpoint: https://api.resend.com/emails
    timeoutMs: 10000
    # Optional seed/fallback. The app-entered key lives on the PVC, not here.
    existingSecret: ""
    apiKeyKey: RESEND_API_KEY

  retry:
    maxAttempts: 5
    baseDelayMs: 500

  podSecurityContext:
    runAsNonRoot: true
    fsGroup: 100          # Bun Alpine image's app group; makes the PVC writable
    fsGroupChangePolicy: OnRootMismatch
    seccompProfile:
      type: RuntimeDefault
  securityContext:
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
    capabilities:
      drop: ["ALL"]

  livenessProbe:
    httpGet: { path: /health, port: http }
    initialDelaySeconds: 10
    periodSeconds: 10
    failureThreshold: 3
  readinessProbe:
    httpGet: { path: /ready, port: http }
    initialDelaySeconds: 5
    periodSeconds: 5
    failureThreshold: 3

  resources:
    requests: { cpu: 50m, memory: 128Mi }
    limits: { cpu: 500m, memory: 256Mi }

  # One node, one replica: no HPA and no PDB. A PDB with minAvailable: 1
  # would block node drains and `helm upgrade` rollouts.
  autoscaling:
    enabled: false
  podDisruptionBudget:
    enabled: false

  networkPolicy:
    enabled: true
```

API producer block for the same profile:

```yaml
api:
  email:
    # `disabled` keeps today's key-free copyable-link behaviour.
    # Flip to `outbox` when M2 lands to exercise the Kafka pipeline; with
    # emailService.provider=sink the event is consumed and logged, not sent.
    mode: disabled
    outboxPollMs: 1000
    outboxBatchSize: 50
    serviceUrl: http://email-service:4200
    kafka:
      clientId: triplanner-api
  reminders:
    enabled: false
```

Both the API and the email service read `INTERNAL_TOKEN` from the same
Secret; that token protects the email settings endpoint.

Notes:

- **`global.appUrl` is the only value that must match the recruiter's browser.**
  It is what the API puts in `joinUrl` and what the email service uses for the
  welcome CTA. If the URL is wrong, the invite link is wrong even though the
  email is delivered.
- One API replica is enough; the outbox relay still uses `FOR UPDATE SKIP
  LOCKED`, so the same code works if the profile is scaled later.
- `ensureTopics: true` is a deliberate local-demo convenience. In a managed
  profile the chart/operator owns topics and the value is `false`.
- **BYOK:** the recruiter adds the Resend key from the app. The key is stored
  0600 in `emailService.persistence` and is never returned to the browser. The
  `resend.existingSecret` value is only an optional seed/fallback; leave it
  empty for the key-free install.
- The email service pod must mount the settings PVC read-write. With one
  replica that is straightforward (`ReadWriteOnce`); a hosted multi-replica
  profile needs a shared store or a per-pod secret, not a shared RWO volume.
- A single-node Kafka with `replicationFactor: 1` has no redundancy. Use a PVC
  for the broker if events must survive a node/pod restart; the API outbox
  still retains unsent invitations while Kafka is down.

#### 9.2.2 Hosted / HA profile (optional)

Use this only when the chart is deployed to a multi-node cluster. It is the
same service; only values change:

```yaml
global:
  appUrl: https://triplanner.example.com

kafka:
  brokers:
    - kafka-bootstrap.kafka.svc.cluster.local:9093
  tls:
    enabled: true
    existingSecret: triplanner-kafka-tls
    caKey: ca.crt
    mountPath: /etc/kafka/ca
    rejectUnauthorized: true
  sasl:
    enabled: true
    mechanism: scram-sha-512
    existingSecret: triplanner-kafka-credentials
    usernameKey: KAFKA_SASL_USERNAME
    passwordKey: KAFKA_SASL_PASSWORD

emailService:
  replicaCount: 2
  provider: resend
  kafka:
    ensureTopics: false       # operator/chart owns topics
    partitions: 6
    replicationFactor: 3
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 6            # useful ceiling = topic partitions
    targetCPUUtilizationPercentage: 70
  podDisruptionBudget:
    enabled: true
    minAvailable: 1
```

### 9.3 Deployment env mapping

The chart's **configuration** is env, not a mounted config file. The only files
mounted into the pod are the runtime BYOK settings on a PVC (data written by
the app) and, in the hosted profile, the Kafka CA bundle.

Email service:

```yaml
env:
  - name: KAFKA_BROKERS
    value: {{ join "," .Values.kafka.brokers | quote }}
  - name: EMAIL_PROVIDER
    value: {{ .Values.emailService.provider | quote }}
  - name: EMAIL_SETTINGS_FILE
    value: {{ .Values.emailService.settingsFile | quote }}
  - name: INTERNAL_TOKEN
    valueFrom:
      secretKeyRef:
        name: {{ .Values.emailService.internalToken.existingSecret }}
        key: {{ .Values.emailService.internalToken.key }}
  - name: KAFKA_SSL
    value: {{ .Values.kafka.tls.enabled | quote }}
  {{- if .Values.kafka.tls.enabled }}
  - name: KAFKA_SSL_CA_PATH
    value: "{{ .Values.kafka.tls.mountPath }}/{{ .Values.kafka.tls.caKey }}"
  {{- end }}
  {{- if .Values.kafka.sasl.enabled }}
  - name: KAFKA_SASL_MECHANISM
    value: {{ .Values.kafka.sasl.mechanism | quote }}
  - name: KAFKA_SASL_USERNAME
    valueFrom:
      secretKeyRef:
        name: {{ .Values.kafka.sasl.existingSecret }}
        key: {{ .Values.kafka.sasl.usernameKey }}
  - name: KAFKA_SASL_PASSWORD
    valueFrom:
      secretKeyRef:
        name: {{ .Values.kafka.sasl.existingSecret }}
        key: {{ .Values.kafka.sasl.passwordKey }}
  {{- end }}
  {{- if .Values.emailService.resend.existingSecret }}
  - name: RESEND_API_KEY
    valueFrom:
      secretKeyRef:
        name: {{ .Values.emailService.resend.existingSecret }}
        key: {{ .Values.emailService.resend.apiKeyKey }}
  {{- end }}
```

API deployment additions:

```yaml
env:
  - name: EMAIL_SERVICE_URL
    value: {{ .Values.api.email.serviceUrl | quote }}
  - name: INTERNAL_TOKEN
    valueFrom:
      secretKeyRef:
        name: {{ .Values.emailService.internalToken.existingSecret }}
        key: {{ .Values.emailService.internalToken.key }}
```

In the single-node profile both `kafka.tls.enabled` and `kafka.sasl.enabled` are
false, so the CA mount and Kafka Secret refs disappear from the rendered
Deployment. With `provider: sink`, the Resend key is not referenced at all.

### 9.4 Secrets

**Single-node recruiter profile:** the only required Secret is the shared
internal token used by the API, agent and email service. There is **no email
provider Secret** in the default path: the recruiter's Resend key is entered in
the app and stored on the settings PVC (0600).

```bash
kubectl -n triplanner create secret generic triplanner-internal \
  --from-literal=INTERNAL_TOKEN="$(openssl rand -hex 32)"
```

Optional seed for an unattended install (the app-entered key still takes
precedence):

```bash
kubectl -n triplanner create secret generic triplanner-email \
  --from-literal=RESEND_API_KEY='re_...'
```

The hosted profile additionally needs Kafka credentials and, if TLS is enabled,
the CA:

```bash
kubectl -n triplanner create secret generic triplanner-kafka-credentials \
  --from-literal=KAFKA_SASL_USERNAME='...' \
  --from-literal=KAFKA_SASL_PASSWORD='...'

kubectl -n triplanner create secret generic triplanner-kafka-tls \
  --from-file=ca.crt=ca.pem
```

Create them outside the chart, or with External Secrets / Sealed Secrets.

Never put these values in `values.yaml`, a ConfigMap, an image layer or a log.
The BYOK settings file is a runtime data file on the PVC, not a chart value.

### 9.5 Topics

**Recruiter single-node profile:** `KAFKA_ENSURE_TOPICS=true` lets the email
service create both topics on first boot with:

| Config | Requests | DLQ |
|---|---|---|
| Partitions | 3 | 3 |
| Replication factor | 1 | 1 |
| `min.insync.replicas` | 1 | 1 |
| `retention.ms` | 604800000 (7d) | 2592000000 (30d) |
| `compression.type` | gzip | gzip |

**Hosted profile:** create the topics with Strimzi `KafkaTopic`, Redpanda
`Topic`, or a Helm post-install Job, set `KAFKA_ENSURE_TOPICS=false`, and use
3/3/2 with 6 partitions. The service should not create topics in a managed
cluster.

> `compression.type=gzip` is a hint, not a guarantee: it does not recompress a
> snappy/lz4/zstd batch produced by another client. Producer configuration is
> the actual enforcement point (see R1).

### 9.6 Network policy

- Email service ingress: TCP 4200 from the API pod (settings proxy) and the
  probe source. No ingress from `web`.
- API egress: TCP 4200 to the email service, plus Kafka brokers for the outbox
  relay.
- Email service egress: DNS 53, Kafka brokers 9092/9093, HTTPS 443 to the
  configured Resend endpoint (or an egress proxy).
- If the cluster uses a service mesh, allow the sidecar's ports.

### 9.7 BYOK runtime settings

The recruiter should not have to rebuild the chart to add a Resend key. This
mirrors the existing LLM BYOK pattern in `agent-service`:

- Environment values are **defaults/fallbacks**.
- A runtime override is stored in `EMAIL_SETTINGS_FILE` (Helm:
  `/app/.data/email.json`) on a `ReadWriteOnce` PVC, mode `0600`.
- Precedence: **runtime override > env > built-in default**.
- The key is never returned by the API, never put in a Kafka event, never in
  `values.yaml`, and never logged.

Internal endpoints on the email service (ClusterIP only):

```http
GET  /api/email/config
     -> { "provider": "sink|resend", "from": "...", "replyTo": "...",
          "hasKey": true|false, "ready": true|false }

POST /api/email/config
     X-Internal-Token: <INTERNAL_TOKEN>
     { "provider": "resend", "apiKey": "re_...", "from": "...",
       "replyTo": "...", "clearKey": false }
     -> the same public shape; the key is never echoed
```

Rules:

- `provider=resend` requires a key (from the request, the existing override, or
  the env fallback). A request that would leave Resend without a key is
  rejected with `EMAIL_CONFIG_INVALID`.
- Leaving `apiKey` blank keeps the stored key when the provider does not
  change, matching the LLM settings behaviour.
- `clearKey: true` removes the override key. It must also switch the provider
  to `sink`, otherwise the request is rejected.
- A key supplied only by env is not copied to disk. The override shadows it
  only when the recruiter explicitly saves a new key.
- Writes are atomic (temp file + rename) and `chmod 0600`; the directory is
  `0700`. The file lives on the PVC, so it survives pod restarts.
- The PVC must be writable by the non-root container user. Set
  `podSecurityContext.fsGroup` to the image's app GID (the Bun Alpine image
  creates `app` as UID/GID 100) or use an initContainer to chown the mount.
- The provider router rebuilds when settings change; the next event uses the
  new key without restarting the pod.
- If the PVC is deleted, the recruiter re-enters the key. An optional
  `emailService.resend.existingSecret` can seed a fallback for unattended
  installs.

API surface:

```graphql
type EmailSettings {
  provider: String!
  from: String!
  replyTo: String!
  hasKey: Boolean!
  ready: Boolean!
}

extend type Query {
  getEmailSettings: EmailSettings!
}

extend type Mutation {
  updateEmailSettings(input: UpdateEmailSettingsInput!): EmailSettings!
}

input UpdateEmailSettingsInput {
  provider: String!
  apiKey: String
  from: String
  replyTo: String
  clearKey: Boolean
}
```

The API requires a signed-in user, proxies to the email service with
`X-Internal-Token`, and maps failures to stable codes
(`EMAIL_SETTINGS_FAILED`, `EMAIL_CONFIG_INVALID`). The browser never receives
the key; it only receives `hasKey`.

UI: a new **Email delivery** section in `ProfileModal`, next to the existing
LLM settings: provider (`sink` demo / `resend`), API key (password field,
blank keeps the saved key), from address and reply-to. Saving shows a toast and
updates the badge. This is the same interaction the recruiter already knows
from the LLM provider.

Security trade-off: the file is plaintext `0600` on a local PVC, exactly like
the agent's `.data/llm.json`. That is acceptable for a single-node recruiter
demo; a hosted deployment should use a secret manager or an encrypted store.
The internal endpoint is protected by `INTERNAL_TOKEN` and a NetworkPolicy that
only allows the API pod to reach port 4200.

## 10. Migration stages

| Stage | Status | Deliverables | Acceptance | Rollback |
|---|---|---|---|---|
| M0 Contract | done | This doc, topic/envelope, ownership | Reviewed; no code | — |
| M1 Service runtime | **done** | `backend/email-service`, templates, provider, consumer, probes, image, 43 tests | `bun test`, `tsc`, image build, local Kafka smoke | Scale to 0; no producer yet |
| M2 Invitation producer | next | Outbox DDL, `enqueueEmail`, relay, transaction, flags, Postgres tests | Invite writes one row + one Kafka event; Kafka down leaves row pending; invite still returns link; replay works | `EMAIL_MODE=disabled` |
| M2b BYOK settings | pending | Settings store, internal config API, GraphQL proxy, ProfileModal section, PVC + Service + `INTERNAL_TOKEN` | Recruiter saves a Resend key from the app; key never returns to the browser; survives a pod restart; no email key in values | Clear key; switch provider to `sink` |
| M3 Reminders + hardening | pending | Sweep→outbox transaction, DLQ replay script, metrics, load test | Reminder event per member once; poison message lands in DLQ; single replica exactly once (two-replica check optional) | `REMINDERS_ENABLED=0` |
| M4 Helm integration | pending (Marco) | Deployment, Service, Secret refs, probes, netpol, topics; HPA/PDB only in the hosted profile | `helm template` + `kubectl rollout status`; one pod ready; `/ready` 200; test invite delivered | `helm rollback` |
| M5 Cutover | pending | Enable `EMAIL_MODE=outbox`, send real invite, watch logs/DLQ | Resend id present; UI link still works; DLQ 0 | Set `EMAIL_MODE=disabled` |
| M6 Decommission | pending | Remove dead code/flags that are no longer needed; keep `disabled` mode for demo | Grep shows one sender; demo still key-free | Revert commit |

## 11. Test matrix

| Layer | What | Where |
|---|---|---|
| Unit | Envelope validation, template escaping, es/en copy | `backend/email-service/test` |
| Unit | Retry/backoff, terminal vs retryable, duplicate suppression, log redaction | `handler.test.ts` |
| Unit | Resend status mapping, idempotency header, timeout, PII redaction | `resend.test.ts` |
| Unit | Config defaults and validation | `config.test.ts` |
| Unit | BYOK precedence, key shadowing, clear-key, `0600` file | `settings.test.ts` (M2b) |
| HTTP | Config endpoint rejects missing token; GET never returns the key | `http.test.ts` (M2b) |
| GraphQL | `getEmailSettings`/`updateEmailSettings` proxy and stable errors | `email-settings.test.ts` (M2b) |
| Manual | Save key → restart pod → next invite uses it; key absent from UI/logs | recruiter checklist |
| Integration | Outbox insert + invitation transaction + relay (Postgres) | `backend/server/test` (M2) |
| Contract | Producer builder output parses in consumer | shared fixture (M2) |
| Kafka smoke | gzip invite → `email.sent`; invalid JSON → DLQ | local Redpanda |
| Failure | Broker down, Resend 500, exhausted retries, poison batch | M3 |
| Security | No secret/recipient in logs; non-root image; secret refs | CI + review |
| Helm | `helm template`, `kubeconform`, rollout, probes | M4 |

### M1 evidence (2026-11-19)

- `bun test` in `backend/email-service`: **43 pass, 0 fail**.
- `bunx tsc --noEmit`: clean.
- `docker build -f backend/email-service/Dockerfile`: success.
- Local Redpanda: `/ready` returned
  `{"status":"ready","provider":"sink","providerReady":true,"kafkaReady":true}`;
  a gzip `email.invite.v1` produced `email.sent` with
  `recipient: "f***@example.com"`; invalid JSON produced an `email.dead_letter`
  entry and a DLQ record with `x-original-topic`, `x-original-offset`,
  `x-error` and `x-attempts` headers.
- Negative test: a snappy batch crashed KafkaJS with
  `Snappy compression not implemented`; this is why R1 is a release blocker
  for any producer not under our control.

## 12. Observability

Structured JSON logs (one line per event):

- `service.start`, `service.shutdown.start/done`
- `kafka.consumer.ready`, `kafka.consumer.crash`, `kafka.consumer.run_failed`
- `kafka.topics.ensured`
- `email.sent`, `email.send.failed`, `email.send.retry`,
  `email.send.exhausted`, `email.dead_letter`
- `email.event.invalid`, `email.event.duplicate`

Never log the payload, the full recipient address, the invite code, the Resend
key or the SASL password.

Metrics (M3):

- `email_events_consumed_total{type,status}`
- `email_send_duration_seconds{provider}`
- `email_dlq_total{reason}`
- `kafka_consumer_lag{partition}`

Alerts:

- DLQ rate > 0 for 10 minutes.
- No `email.sent` for 15 minutes while the request topic has traffic.
- `/ready` failing for 5 minutes.
- Consumer crash loop.

## 13. Security and privacy

- Kafka payloads contain email addresses and invite codes. The single-node
  profile keeps Kafka plaintext inside the pod network and relies on namespace
  isolation; the hosted profile enables TLS, SASL, topic ACLs and encryption at
  rest. Restrict DLQ read access in both cases.
- DLQ retention is 30 days by default; shorten it if policy requires.
- The email service runs as non-root, read-only root filesystem, all
  capabilities dropped, seccomp `RuntimeDefault`.
- Resend key scope: sending only; rotate via Secret update + rollout.
- No outbound access except Kafka, DNS, Resend (and the container registry for
  pulls).
- Invite links remain the fallback in the UI; email is never the only path to
  join a trip.

## 14. Risks and open decisions

| # | Risk / decision | Impact | Mitigation |
|---|---|---|---|
| R1 | **KafkaJS 2.2.x decodes only gzip** | A snappy/lz4/zstd batch crashes the consumer; topic `compression.type=gzip` did **not** recompress an existing snappy batch in the local Redpanda test | Producers must send gzip or none; relay sets `CompressionTypes.GZIP`; startup logs `compression: gzip-only`; fail-fast on crash; evaluate Confluent's client or a Node runtime if polyglot producers are required |
| R2 | KafkaJS is unmaintained (last release 2023) | Security/compat risk | Keep the adapter isolated in `consumer.ts`; revisit before a second consumer |
| R3 | Kafka provider/TLS/SASL unknown | Helm values differ (Strimzi vs MSK vs Confluent) | Values contract supports TLS + SASL; Marco chooses the operator and secret layout |
| R4 | Outbox relay lag / stuck row | Invitation email delayed | `SKIP LOCKED` batches, attempts + alert, operator replay |
| R5 | Resend free tier only sends to the verified address | Demo may not deliver to arbitrary recipients | Use `sink` for local; use a verified domain/key for the demo |
| R6 | In-memory dedupe is per pod | Duplicate after restart/offset reset | Resend idempotency key covers 24h; acceptable for email |
| R7 | PII in Kafka and DLQ | Privacy exposure | ACLs, TLS, retention, restricted DLQ access |
| R8 | AGENTS.md still says "No Resend" | Reviewers may reject the change | Proposed amendment below; demo stays key-free |
| R9 | Helm chart is still scaffold | Values are a contract, not deployed | Marco owns M4; backend provides the image and env contract |
| R10 | **Single node = single failure domain** | Kafka RF 1 has no redundancy; a node restart can lose in-flight events if the broker uses ephemeral storage; one email pod means delivery pauses during restarts | Use a PVC for the broker, keep the API outbox as the durable source for unsent invitations, accept best-effort demo delivery, and do not promise HA in the recruiter profile |
| R11 | **BYOK key is plaintext on a PVC** | Anyone with volume access can read the Resend key; deleting the PVC loses it | File `0600`/directory `0700`, non-root pod, PVC access restricted to the service account, optional Secret seed; document as demo-grade and use a secret manager for hosted deployments |

## 15. Proposed AGENTS.md amendment

Do not apply until the owner approves. Replace the "No Resend" bullet with:

> - **Email is optional and off by default.** `EMAIL_MODE=disabled` keeps the
>   local demo key-free; invitations expose a copyable join link. In Kubernetes,
>   `EMAIL_MODE=outbox` publishes invitation/reminder events to Kafka and the
>   email service delivers them through Resend when configured. No Resend key is
>   required to run the recruiter demo.
> - **BYOK email:** the recruiter can add their own Resend key from the app. It
>   is stored `0600` on the email-service PVC and is never returned to the
>   browser, put in a Kafka event or shipped with the repo/chart.

And adjust the goal sentence "with no Firebase, HasData, Resend or AWS account"
to "with no Firebase, HasData or AWS account; email is optional".

## 16. Rollback runbook

1. **Stop producing:** set `api.email.mode=disabled` (or `EMAIL_MODE=disabled`)
   and restart the API. Invitations keep working; pending outbox rows stay.
2. **Stop consuming:** scale `emailService` to 0. Kafka retains events for 7
   days.
3. **Bad image:** `helm rollback` or pin the previous tag. Offsets are committed
   only after a successful send, so replay is safe with the same event ids.
4. **Resend outage:** let retries exhaust to the DLQ, then replay after the
   provider recovers (M3 script). Do not disable idempotency keys.
5. **Poison batch (non-gzip):** scale the consumer to 0, inspect the partition
   with `rpk topic consume`, reset the group offset past the batch or recreate
   the topic, then scale back. Fix the producer first; otherwise it repeats.
6. **Compromised Resend key:** in the app, switch provider to `sink` or clear
   the key, rotate the key in Resend, then re-enter it. No redeploy is needed.
7. **Lost settings PVC:** the runtime key is gone; re-enter it in the app or
   rely on the optional `emailService.resend.existingSecret` seed.

## 17. Local end-to-end smoke

See `backend/email-service/README.md`. The short version:

```bash
docker run -d --name redpanda -p 9092:9092 redpandadata/redpanda:v24.2.18 \
  redpanda start --overprovisioned --smp 1 --memory 1G --reserve-memory 0M \
  --node-id 0 --check=false \
  --kafka-addr PLAINTEXT://0.0.0.0:29092,OUTSIDE://0.0.0.0:9092 \
  --advertise-kafka-addr PLAINTEXT://localhost:29092,OUTSIDE://localhost:9092

cd backend/email-service
cp .env.example .env
bun install
bun run start
# in another shell, produce with -z gzip (see README)
```

Expected: `/ready` 200, `email.sent` log, and a DLQ record for malformed JSON.
