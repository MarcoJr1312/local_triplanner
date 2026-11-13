# aws-infra

Terraform for the Triplanner **full-ephemeral demo stack** in `us-east-1`.

The app stack is applied on demand and destroyed after 30 minutes without traffic. Data loss on destroy is accepted. A small control plane (Terraform state, wake/sleep Lambdas, EventBridge, GitHub token, ECR, ACM and the status page) stays alive so the wake button still works while the app is down.

## Layout

```
aws-infra/
├── bootstrap/             # S3 bucket for Terraform state (run once, local state)
├── modules/
│   ├── network/           # VPC, 2 AZs, subnets, NAT, endpoints, security groups
│   ├── data/              # RDS Postgres Single-AZ + DynamoDB locations table
│   ├── storage/           # S3 uploads, KMS, Secrets Manager containers
│   ├── registry/          # ECR repositories for web/api/agent
│   ├── ingress/           # ALB + AWS WAF + optional ACM certificate
│   ├── ecs/               # ECS cluster, Cloud Map, task definitions and services
│   └── control-plane/     # wake/sleep Lambdas, EventBridge, control state table
└── envs/prod/             # single production environment wiring
```

## Prerequisites

- Terraform >= 1.10 (S3 native state locking).
- AWS CLI authenticated with an account that can create VPC, RDS, ECS, ALB, WAF, Lambda, IAM, S3, DynamoDB, Secrets Manager and ECR.
- A GitHub repository for the wake/sleep workflows.
- An ACM certificate ARN for the ALB hostname (optional until Cloudflare DNS is provided).

## 1. Bootstrap the state bucket

```bash
cd aws-infra/bootstrap
terraform init
terraform apply
```

Note the `state_bucket` output. The `envs/prod` backend uses the bucket name `triplanner-tfstate-<account-id>`; adjust `envs/prod/versions.tf` if your account differs.

## 2. Control plane (persistent)

```bash
cd aws-infra/envs/control-plane
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply

aws secretsmanager put-secret-value \
  --secret-id triplanner/github-token \
  --secret-string "$GITHUB_TOKEN"
```

This creates the wake API, idle checker, control table, ECR repositories and the GitHub OIDC role. These resources are not destroyed by the sleep workflow.

## 3. Configure prod

```bash
cd aws-infra/envs/prod
cp terraform.tfvars.example terraform.tfvars
# fill: images, github_repo, certificate_arn, domain (optional)
terraform init
terraform plan
```

The first `apply` is also the first wake. It creates the VPC, RDS Single-AZ, DynamoDB, S3, ECR, ALB/WAF, ECS services and the control plane.

## 4. Wake and sleep

- The wake button is **TBD**. The control plane exposes an HTTP API `POST /wake` that dispatches a GitHub `repository_dispatch` event of type `wake`.
- The GitHub Actions `wake` workflow should run `terraform apply -var="desired_count=1"`, run Postgres migrations and seed (Postgres + DynamoDB), update the Cloudflare CNAME to the new ALB, and finally set the control state to `awake`.
- The `sleep` workflow runs `terraform destroy` after the sleep-check Lambda sees 30 minutes without ALB traffic. It should set the control state to `sleeping`/`asleep`.

## 5. GitHub Actions

The workflows in `.github/workflows/` expect:

**Secrets**

| Secret | Value |
|---|---|
| `AWS_ROLE_ARN` | `github_actions_role_arn` output from `envs/control-plane` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (DNS edit) |
| `CLOUDFLARE_ZONE_ID` | Cloudflare zone ID |

**Variables**

| Variable | Value |
|---|---|
| `WEB_IMAGE`, `API_IMAGE`, `AGENT_IMAGE` | ECR image URIs, e.g. `484826611314.dkr.ecr.us-east-1.amazonaws.com/triplanner/api:latest` |
| `FIREBASE_PROJECT_ID` | Firebase project id |
| `CERTIFICATE_ARN` | ACM certificate ARN, or empty for HTTP-only |
| `APP_HOSTNAME` | Public hostname for the CNAME |
| `CONTROL_TABLE` | `triplanner-control` |

The **build-images** workflow builds `web`, `api` and `agent` from the Dockerfiles (context = repo root), pushes `<sha>` and `:latest` tags to ECR, and runs on `main` plus manual dispatch. The OIDC role only trusts `refs/heads/main`, so dispatch it from that branch. Point the three `*_IMAGE` variables at the `:latest` URIs.

The **wake** workflow runs `terraform apply`, updates Cloudflare, runs `bun run db:migrate` and `bun run db:seed` as one-off ECS tasks, and marks the control table `awake`. The **sleep** workflow runs `terraform destroy` and marks it `asleep`.

The API image must include `db:migrate` and `db:seed` scripts before the workflows can complete.

> The GitHub OIDC role currently uses `AdministratorAccess` because the workflows create and destroy the whole stack. Tighten it to the exact services before using this outside the demo.

## 6. What survives a destroy

- Terraform state bucket.
- Wake/sleep Lambdas, EventBridge rule and control state table.
- GitHub token secret and AWS OIDC role.
- ECR repositories and images.
- ACM certificate and Cloudflare API token.
- Static wake/status page (to be added).

Everything else is destroyed, including RDS, DynamoDB, S3 uploads and app secrets.

## Warnings

- **Data is deleted on destroy.** This is a demo; do not store real data.
- RDS is **Single-AZ** on purpose to keep cold start shorter. There is no HA guarantee.
- The ALB DNS name changes on every apply. The wake workflow must update the Cloudflare CNAME.
- Cold start is expected to be ~8–12 minutes; measure the first apply.
- `desired_count` defaults to 0. The wake workflow must pass `-var="desired_count=1"` (or update ECS services after apply).
- Next.js `NEXT_PUBLIC_*` Firebase values are build-time; set them in the image build, not only in the ECS task environment.
