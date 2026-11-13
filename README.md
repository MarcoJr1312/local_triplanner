# Triplanner

Collaborative travel planning web app. Plan a trip with your team: build a
day-by-day itinerary, organize activities and budgets, invite collaborators,
attach tickets with per-file visibility, get AI suggestions, and jump straight
to Google Maps routes or an Uber deep link.

The product UI is **Spanish by default**, with an **es/en** switch.

**Status:** local development plus a **full-ephemeral AWS demo** in `us-east-1`.
The app stack is created on demand and destroyed after 30 minutes without
traffic; only a small control plane stays alive. DNS is not configured yet, so
the ALB DNS name changes on every wake.

## Features

- **Trips and itineraries** — multiple trips, day-by-day plans, activity
  categories (`sight`, `food`, `activity`, `nightlife`), costs and budgets.
- **Collaboration** — invitations by email, owner / editor / viewer roles,
  real-time trip updates and presence.
- **AI suggestions** — a suggestion agent that knows the trip context, plus
  interest-based automatic suggestions and one-day trip templates.
- **Calendar view** — every day of the trip in a monthly grid.
- **Attachments** — tickets and documents per activity; the uploader chooses
  who can see each file. PDFs render inline.
- **Places search** — cache-first HasData search with favorites first, backed by
  a DynamoDB catalogue.
- **Routes** — multi-stop Google Maps route ordered by start time (max 10
  stops), with an optional current-location origin.
- **Uber** — per-activity deep link with the destination preloaded.
- **Email** — invitations and activity reminders via Resend.
- **Profiles** — name, avatar, language and light/dark theme.
- **Auth** — Firebase Auth (email + password and Google) when configured;
  otherwise demo auth via `x-user-id`.

## Architecture

```
Browser
  │
  ▼
Next.js frontend
  ├─ /api/graphql ─────────── proxy ──▶ GraphQL server ──▶ Postgres
  │                                                    └─▶ DynamoDB (locations)
  ├─ /api/agent/* ─────────── proxy ──▶ Agent service ──▶ Postgres (pgvector) + DeepSeek
  └─ /uploads/* ───────────── route ──▶ GraphQL server ──▶ Storage (local disk or S3)
```

- The browser only talks to the Next.js origin. It never sees backend URLs.
- HasData, Resend, DeepSeek and Firebase credentials live **server-side only**.
- No sensitive value is exposed through `NEXT_PUBLIC_*`.

## Tech stack

| Area | Stack |
|---|---|
| Frontend (`frontend-next/`) | Next.js 15 App Router, React 19, TypeScript, shadcn/ui on Radix, Tailwind v4, next-themes, sonner |
| Backend (`local/server/`) | TypeScript on Bun, graphql-yoga, Postgres (`pg`), DynamoDB (locations), Storage abstraction, `firebase-admin`, `jose` |
| Agent (`local/agent-service/`) | Python 3.12, uv, FastAPI, Agno, pgvector (Postgres), DeepSeek |
| Data (`local/db/`) | Postgres `pg/schema.sql` + idempotent seed; DynamoDB catalogue seeded from `seed-data.json` |
| Local infra | Docker Compose: Postgres 17 + pgvector, DynamoDB Local, MinIO |
| AWS demo | ECS Fargate, RDS Postgres Single-AZ, DynamoDB, S3, ALB + WAF, ECR, Terraform + GitHub Actions OIDC |

### Data placement

- **Postgres / RDS** — users, trips, members, items, invitations, attachments
  metadata, favorites, interests, chats, reminders, agent embeddings.
- **DynamoDB** — the `locations` catalogue (HasData results, `place_id` /
  `data_id` GSIs, TTL). Postgres stores denormalized place snapshots, so trip
  reads never fan out to DynamoDB.
- **Storage** — avatars, trip covers and attachment bytes. Local disk in dev,
  S3 in AWS. Attachment URLs stay short-lived HMAC-signed.

## Repository layout

```
.
├── frontend-next/          Next.js app (App Router, shadcn/ui, i18n)
├── local/
│   ├── server/             GraphQL API, auth, uploads, HasData, email
│   ├── agent-service/      FastAPI suggestion agent (pgvector)
│   ├── db/                 pg/schema.sql + seed-data.json
│   ├── graphql/            base schema
│   └── .env.example        backend configuration template
├── aws-infra/              Terraform: bootstrap, control plane, prod stack
├── .github/workflows/      build-images, wake, sleep
├── docker-compose.yml      local Postgres + DynamoDB + MinIO
└── AGENTS.md               project conventions for AI agents
```

### Frontend routes

| Route | Screen |
|---|---|
| `/` | My trips dashboard |
| `/trip/[id]` | Trip detail: days, activities, budget, members, calendar, search |
| `/login` | Sign in / sign up |
| `/join` | Accept a trip invitation |
| `/verify` | Email verification |
| `/api/graphql` | GraphQL proxy to the backend |
| `/api/agent/[...path]` | Proxy to the agent service |
| `/uploads/[...path]` | Runtime proxy to backend object storage |

## Prerequisites

- [Bun](https://bun.sh/) (JS package manager and runtime)
- [Docker](https://www.docker.com/) for Postgres, DynamoDB Local and MinIO
- [uv](https://docs.astral.sh/uv/) and Python 3.12+ (agent service)
- **Optional:** Firebase service account for real auth, HasData/Resend/DeepSeek
  keys. Missing keys disable only those features.

## Local development

### 1. Data stores

```bash
docker compose up -d            # Postgres 17 + pgvector, DynamoDB Local, MinIO
cp local/.env.example local/.env
cd local/server
bun install
bun run db:migrate              # Postgres schema
bun run db:seed                 # demo data + DynamoDB catalogue
```

The seed is idempotent and creates two destinations, their activities and a demo
user/trip. The server also bootstraps schema and catalogue on boot when
`LOCAL_ONLY=1`.

### 2. Services

```bash
# GraphQL API — http://localhost:4000/graphql (GraphiQL enabled)
cd local/server && bun run dev

# Frontend — http://localhost:3000
cd frontend-next && bun install && bun run dev

# Agent — http://localhost:4100
cd local/agent-service && uv sync
uv run uvicorn tripsuggest.main:app --host 127.0.0.1 --port 4100
```

### 3. Storage

By default bytes go to `local/server/uploads` (gitignored). To use MinIO:

```bash
S3_BUCKET=triplanner-uploads
S3_ENDPOINT=http://localhost:9000
S3_FORCE_PATH_STYLE=1
AWS_ACCESS_KEY_ID=triplanner
AWS_SECRET_ACCESS_KEY=triplanner123
```

The MinIO console is at http://localhost:9001.

### 4. Verify

- http://localhost:3000
- GraphiQL: http://localhost:4000/graphql
- Agent health: `curl http://localhost:4100/health`

## Configuration

### Backend (`local/.env`)

| Variable | Purpose |
|---|---|
| `HASDATA_API_KEY` | Places search (backend only) |
| `RESEND_API_KEY`, `RESEND_FROM` | Invitation and reminder emails |
| `APP_URL` | Public frontend base for invitation links |
| `LOCAL_ONLY` | `1` = demo auth via `x-user-id` and no Firebase requirement |
| `BOOTSTRAP_LOCAL` | Create schema/table on boot (defaults to `LOCAL_ONLY`; `0` in AWS) |
| `LOCAL_PORT` | GraphQL port (default `4000`) |
| `ATTACHMENT_TOKEN_SECRET` | HMAC secret for signed attachment URLs |
| `INTERNAL_TOKEN` | Shared secret for `/internal/*` endpoints |
| `AGENT_BASE_URL` | Agent base URL (default `http://127.0.0.1:4100`) |
| `DATABASE_URL` | Postgres connection string (local default `triplanner` db) |
| `DB_SECRET_ARN`, `DB_HOST`, `DB_PORT`, `DB_NAME` | AWS: build the URL from the RDS-managed secret |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | Object storage (unset = local disk) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY` | Firebase project config |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Admin SDK service account JSON |

### Frontend (`frontend-next/.env.local`)

| Variable | Purpose |
|---|---|
| `NEXT_PRIVATE_BACKEND_URL` | Server-side GraphQL URL (falls back to `localhost:4000`) |
| `NEXT_PRIVATE_BACKEND_ORIGIN` | Optional uploads origin (derived from the GraphQL URL) |

### Agent (`local/agent-service/.env`)

| Variable | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | LLM provider |
| `INTERNAL_TOKEN` | Shared secret with the backend |
| `DATABASE_URL` | Postgres with pgvector (same database as the backend) |
| `BACKEND_URL` | Internal backend base URL (default `http://127.0.0.1:4000`) |
| `AGENT_DEMO_MODE` | `true` = accept `X-User-Id` without Firebase |
| `AGENT_FIREBASE_SERVICE_ACCOUNT_PATH` | Firebase Admin service account |
| `FIREBASE_PROJECT_ID` | Project whose tokens are verified |
| `AGENT_LLM_MODEL` | Model name (optional) |

## Testing

```bash
# Backend: 81 integration tests (Postgres + DynamoDB + MinIO) + strict typecheck
cd local/server && bun test
cd local/server && bunx tsc --noEmit

# Agent: 10 tests against triplanner_agent_test (deterministic embedder)
cd local/agent-service && uv run python tests/test_m2.py

# Frontend helpers (routes, geolocation, Uber links)
cd frontend-next && bun test
```

The backend suites run against `triplanner_test`; they never touch dev data.

## AWS demo (ephemeral)

Terraform lives in `aws-infra/`. Two stacks share one S3 state bucket: a small
**control plane** that survives sleep, and the **app stack** that is created on
wake and destroyed on sleep.

### AWS architecture

```
GitHub Actions (OIDC) ──▶ Terraform apply/destroy + ECR pushes

Internet
  │
  ▼
ALB + AWS WAF ──▶ ECS web (Next.js) ──/api/graphql──▶ ECS api (Bun + GraphQL)
                                                        ├──▶ RDS Postgres (relational)
                                                        ├──▶ RDS pgvector (agent embeddings)
                                                        ├──▶ DynamoDB (locations)
                                                        └──▶ S3 (avatars, covers, attachments)
                     ECS web ──/api/agent/*──▶ ECS agent (FastAPI, internal only)
```

### Stacks and state

| Stack | State key | Lifecycle |
|---|---|---|
| `bootstrap/` | `bootstrap/terraform.tfstate` | applied once; S3 state bucket |
| `envs/control-plane/` | `control-plane/terraform.tfstate` | persistent (~$1/month) |
| `envs/prod/` | `prod/terraform.tfstate` | destroyed on sleep |

All state lives in `s3://triplanner-tfstate-484826611314` with native lockfile,
versioning, SSE-AES256 and public access blocked.

### Control plane (persistent)

| Resource | Purpose |
|---|---|
| S3 state bucket | versioned, encrypted, public access blocked |
| DynamoDB `triplanner-control` | stack state: `asleep` / `waking` / `awake` / `sleeping` / `error` |
| Wake Lambda + API Gateway `POST /wake` | dispatches `repository_dispatch("wake")` |
| Sleep Lambda + EventBridge `rate(5 minutes)` | checks ALB traffic and dispatches sleep after 30 idle minutes |
| ECR `triplanner/{web,api,agent}` | images survive destroy |
| Secrets Manager `triplanner/github-token` | PAT used by the sleep Lambda (`Actions: write`) |
| GitHub OIDC provider + `triplanner-github-actions` role | assumed only from `refs/heads/main`; accepts legacy and immutable-id `sub` claims |

### App stack (destroyed on sleep)

| Module | Resources |
|---|---|
| `network` | VPC `10.0.0.0/16`, 2 AZs, public/private subnets, NAT, VPC endpoints, security groups |
| `data` | RDS Postgres 16 Single-AZ (`db.t4g.micro`, gp3, encrypted, `rds.force_ssl=1`, managed master secret); DynamoDB `triplanner-locations` (pk `id`, `place_id`/`data_id` GSIs, TTL) |
| `storage` | S3 uploads bucket (SSE, versioning, public blocked), KMS key, Secrets Manager containers for HasData/Resend/DeepSeek/Firebase/internal token |
| `registry` | ECR lifecycle policies |
| `ingress` | ALB, AWS WAF, optional ACM certificate, target group |
| `ecs` | Fargate cluster, Cloud Map namespace `triplanner.local` (A records), web/api/agent task definitions and services, log groups, task roles |

The API container gets `DATABASE_URL` from the RDS-managed secret and runs with
`LOCAL_ONLY=1` (demo auth) plus `BOOTSTRAP_LOCAL=0` (Terraform owns the schema and
catalogue). The agent gets `BACKEND_URL=http://api.triplanner.local:4000` and
`INTERNAL_TOKEN`, and resolves its own DB URL from the same secret.

### One-time setup

```bash
# 1. state bucket
cd aws-infra/bootstrap
terraform init && terraform apply

# 2. persistent control plane
cd ../envs/control-plane
cp terraform.tfvars.example terraform.tfvars
terraform init && terraform apply

# 3. token for the sleep Lambda (PAT with Actions: write)
aws secretsmanager put-secret-value \
  --secret-id triplanner/github-token \
  --secret-string file://token.txt
```

The control-plane tfvars needs `github_repo` plus the immutable
`github_owner_id` / `github_repo_id`; GitHub includes them in the OIDC `sub`
claim.

### Images

`.github/workflows/build-images.yml` builds `web`, `api` and `agent` from the
repo-root Dockerfiles, pushes `<sha>` and `:latest` tags to ECR, and fails fast if
a repository is missing. It runs on `main` (the OIDC role only trusts that ref)
and via manual dispatch.

The API image keeps `CMD` (not `ENTRYPOINT`) so `wake.yml` can override it with
`bun run db:migrate` / `bun run db:seed`.

### GitHub settings

Secret: `AWS_ROLE_ARN`.

Variables: `WEB_IMAGE`, `API_IMAGE`, `AGENT_IMAGE`, `FIREBASE_PROJECT_ID`,
`CONTROL_TABLE`; later `CERTIFICATE_ARN` and `APP_HOSTNAME` (plus the Cloudflare
secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID`).

### Wake / sleep flow

1. `POST /wake` → Lambda sets `waking` → GitHub `repository_dispatch("wake")`.
2. `wake.yml` runs `terraform apply` (~8–12 min), updates the Cloudflare CNAME if
   configured, runs migrations and seed as one-off ECS tasks, and marks `awake`.
3. Every 5 minutes the sleep Lambda reads `RequestCount` /
   `ActiveConnectionCount`; after 30 idle minutes it sets `sleeping` and
   dispatches `sleep`.
4. `sleep.yml` runs `terraform destroy` and marks `asleep`.

Manual equivalents:

```bash
cd aws-infra/envs/prod
terraform output                      # ALB DNS, cluster, subnets, bucket
aws ecs run-task ...                  # db:migrate / db:seed one-off
aws logs get-log-events ...           # /ecs/triplanner/{web,api,agent}
```

### Data and cost

- **Destroyed:** VPC, NAT, ECS, ALB/WAF, RDS, DynamoDB, S3 objects, app secrets and
  logs. No final RDS snapshot; data loss is accepted.
- **Survives:** state bucket, control table, wake/sleep Lambdas, EventBridge, ECR
  images, ACM certificate, OIDC role and the GitHub token secret.
- Idle ≈ **$1/month**; awake ≈ **$0.15–0.30/hour**.
- HTTP-only until ACM + DNS; the ALB DNS name changes on every wake.
- `wake.yml` uses `-auto-approve` for the button-driven demo; that exception is
  recorded on the deploy task. No other apply/destroy runs without owner
  approval.

See [`aws-infra/README.md`](aws-infra/README.md) for the full runbook.

## Conventions and guardrails

- **Security** — membership checks on every read and mutation; attachments gated
  by per-file visibility and short-lived HMAC URLs; no secrets in the client or
  the repository.
- **i18n** — every UI string goes through `t()`, with mirrored `es`/`en` keys;
  API errors travel as stable codes.
- **Data** — `local/db/pg/schema.sql` is the source of truth for Postgres; the
  seed is idempotent; uploads, local env files and Terraform state are
  gitignored.
- **Branches** — one `feature/*` or `fix/*` branch per delivery, pushed only to
  that branch. `main` changes through PRs.
- **AWS deploys** — zero applies or destroys without explicit owner
  authorization; the wake/sleep button is the standing authorization for the
  demo stack.

## Troubleshooting

- **Next.js `Cannot find module './<n>.js'`** — never run `next build` while
  `next dev` serves the same `.next` directory. Kill dev, delete
  `frontend-next/.next`, restart. Builds use separate directories.
- **GitHub Actions `Not authorized to perform sts:AssumeRoleWithWebIdentity`** —
  the OIDC `sub` claim now includes immutable ids
  (`repo:owner@id/repo@id:ref:refs/heads/main`). The trust policy accepts both
  formats; keep `github_owner_id` / `github_repo_id` in the control-plane vars.
- **ECS task fails before starting** — every `secrets` entry must have a value
  (`AWSCURRENT`). Empty Terraform-created secret containers block task startup.
- **RDS `self signed certificate in chain`** — the runtime does not ship the RDS
  CA bundle; the demo connects with `sslmode=no-verify` (TLS without CA
  verification).

See [AGENTS.md](AGENTS.md) for the full project working agreement.
