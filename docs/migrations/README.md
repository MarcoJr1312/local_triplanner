# Microservice migration playbook

This directory records each backend extraction. The goal is a repeatable,
reviewable path from the current modular monolith to a small set of
independently deployable services, without breaking the recruiter demo.

Migrations:

- [`0001-email-service.md`](./0001-email-service.md) — email consumer, BYOK
- [`0002-go-broker.md`](./0002-go-broker.md) — Go HTTP broker + `TripInvitation`

## Branching (local only)

`refactor/helm` is the integration branch for this phase. **Nothing is pushed to
GitHub.**

Git cannot store both `refs/heads/refactor/helm` and a nested
`refs/heads/refactor/helm/<service>`; the first is a file and the second needs a
directory. Service branches therefore use the flat prefix:

```
refactor/helm-<service>        e.g. refactor/helm-email-service
```

Work stays local and merges back into `refactor/helm` when the slice is green.

## The eight gates

Every extraction goes through the same gates. A later gate does not start until
the previous one has evidence.

| Gate | Deliverable | Evidence |
|---|---|---|
| 0. Baseline | Current behaviour, owner, rollback switch | Test run + feature flag name |
| 1. Contract | Versioned event/API schema and ownership | `docs/migrations/NNNN-*.md` reviewed |
| 2. Skeleton | Independently runnable service, health probes | `bun test`, typecheck, image build |
| 3. Producer | Transactional outbox + relay (no dual writes) | Postgres test: row written with the domain change |
| 4. Consumer | Retries, idempotency, DLQ, graceful shutdown | Failure-injection tests |
| 5. Local e2e | Real broker + real producer → consumer | Smoke output in the PR/commit notes |
| 6. Helm handoff | Values contract, secrets, probes, PDB, netpol | `helm template` diff reviewed by infra owner |
| 7. Cutover | Flag flipped, dashboards watched, rollback proven | One real event + no DLQ growth |
| 8. Decommission | Legacy path removed; fallback documented | Grep proves no second sender |

## Definition of done

- [ ] Contract is versioned and additive; unknown versions go to a DLQ.
- [ ] Producer writes the event in the same transaction as the domain change.
- [ ] Consumer is idempotent across restarts and replicas.
- [ ] Retryable vs terminal errors are explicit; DLQ has a replay runbook.
- [ ] Health and readiness are separate; SIGTERM drains cleanly.
- [ ] No secret in values, images, logs or browser.
- [ ] Non-root, read-only root filesystem, dropped capabilities.
- [ ] Tests and typecheck pass; integration smoke is recorded.
- [ ] Helm values are documented as env vars, one table.
- [ ] Rollback is a flag, not a redeploy of the old service.

## Values conventions

Use one shared block for infrastructure that several services consume, and one
block per service for workload settings:

```yaml
global:
  appUrl: http://localhost:3000   # the URL the recruiter actually opens

kafka:                 # shared by api (producer) and email (consumer)
  brokers: []
  tls: { enabled: false }
  sasl: { enabled: false }

emailService:
  enabled: true
  replicaCount: 1      # recruiter node = single replica
  provider: sink       # recruiter switches to resend in the app
  service:
    enabled: true
    type: ClusterIP
    port: 4200
  settingsFile: /app/.data/email.json
  persistence:
    enabled: true
    size: 1Gi
  internalToken:
    existingSecret: triplanner-internal
    key: INTERNAL_TOKEN
  podSecurityContext:
    runAsNonRoot: true
    fsGroup: 101                  # makes the PVC writable by the Bun app group

api:
  email:
    serviceUrl: http://triplanner-email:4200
```

The default profile is a **single-node recruiter install**: one replica per
workload, no HPA/PDB, plaintext Kafka inside the pod network, and
`appUrl=http://localhost:3000` (or the NodePort/Ingress URL the recruiter
opens). A hosted profile can raise replicas and enable TLS/SASL; it is an
override, not the baseline.

Provider keys follow the **BYOK** convention: the recruiter enters them in the
app, the service stores the override `0600` on its PVC, and the chart only
carries an optional seed. Never put a provider key in `values.yaml`.

Rules:

1. Secrets are references (`existingSecret` + key), never literal values.
2. Env var names are stable; values map to them explicitly in the migration doc.
3. Topic creation belongs to the chart/operator, not the application
   (`KAFKA_ENSURE_TOPICS=false` in Kubernetes).
4. Every service gets `/health` (liveness) and `/ready` (dependency-aware).
5. Every deployment sets `runAsNonRoot`, `allowPrivilegeEscalation: false`,
   `readOnlyRootFilesystem: true`, and drops all capabilities.

## Anti-patterns

- **Dual write**: writing Postgres and publishing to Kafka in separate steps.
  Use an outbox.
- **Sync fallback chain**: calling Resend from the API when Kafka is down. Keep
  the current user-visible fallback (copyable link) instead.
- **At-most-once by accident**: committing before the side effect.
- **Unbounded retries**: blocks a partition and hides a bad payload.
- **Payload logging**: email addresses and invite codes are PII.
- **App-created topics in production**: hides ownership and retention policy.
- **One giant `values.yaml`**: shared infra block + per-service block.
