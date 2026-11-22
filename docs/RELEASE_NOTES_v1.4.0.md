# Release notes — v1.4.0 (users service)

| Field | Value |
|---|---|
| Status | Release candidate; Docker Hub publish and published-stack smoke pending |
| Chart | `helm-triplanner` 0.7.0 (`appVersion` 0.4.0) |
| Images | users `0.1.0`, trips `0.1.1`, API/web `1.3.0`; email `0.1.1`, locations `0.2.1`, broker `0.1.0` unchanged |
| Contract | `docs/migrations/0008-users-service.md` |
| Cutover | `docs/migrations/0009-users-cutover.md` |
| QA | `docs/migrations/0010-users-qa.md` (Gate 2 approved) |

## Highlights

- **Users microservice** (`backend/users-service`, `:4500`) with its own
  PostgreSQL StatefulSet, username + password login (Argon2id), search/batch,
  profile update, protected soft delete and a local notification inbox.
- **English by default.** New accounts, the demo seed and a fresh browser start
  in English; Spanish remains available in Settings → Language.
- **No JWT.** Login returns the profile; the browser keeps the UUID and sends
  `x-user-id`. Demo accounts: `demo` / `demo123` and `demo-friend` / `demo123`
  with fixed UUIDs `11111111-1111-4111-8111-111111111111` and
  `22222222-2222-4222-8222-222222222222`.
- **Local invites by username.** The invite modal adds a **Por usuario** tab;
  the invitee sees it in the notification bell (`myNotifications` +
  `onNotification`) and accepts or declines. No email, code or outbox row is
  created for local invites.
- **Account admin from the login screen.** Create any number of accounts and
  delete non-protected ones. Demo accounts are protected; deleting a trip owner
  is blocked with `USER_OWNS_TRIPS`.
- **Fixed-UUID migration** copies platform users into the users service and
  rewrites every platform and trips reference. It is dry-run by default and
  idempotent.
- **Decommission**: `USERS_MODE`, the local users adapter and the platform
  `users`/`notifications` tables are gone. The API is remote-only; the platform
  keeps opaque user ids on attachments/favorites/interests/chats/vectors.
- **Deployment**: Compose adds `users` + `users-postgres`; Helm chart 0.7.0 adds
  the users Deployment, 2Gi StatefulSet, credentials Secret, probes,
  SA/RBAC/proxy, NetworkPolicies and a `helm test` hook.

## Upgrade

1. Back up the platform and trips databases.
2. Deploy the users service/PostgreSQL and let it seed the demo accounts.
3. Run the fixed-UUID migration dry-run, then apply:
   ```bash
   cd backend/users-service
   LEGACY_DATABASE_URL=... TRIPS_DATABASE_URL=... USERS_DATABASE_URL=... \
     bun scripts/migrate-users.ts
   APPLY=1 ... bun scripts/migrate-users.ts
   ```
4. Deploy the new API/web images (the API needs `USERS_URL`, default
   `http://127.0.0.1:4500` / `http://users:4500`).
5. After verification, run `backend/db/pg/decommission-users.sql` once on the
   platform database.
6. Helm: `helm upgrade triplanner helm/helm-triplanner -n triplanner --wait`.

## Breaking changes

- Login is username/password; the old demo buttons and `loginDemo` are removed.
- User ids are UUIDs. `registerUser`, `findUserByEmail` and `inviteMember` are
  removed; use `createUser`, `listUsers`/`getUserByUsername` and
  `tripLocalInvite`.
- `UserProfile.email` and `Member.email` are nullable; `UserProfile.deletedAt`
  is exposed. `Notification.inviter` is nullable.
- `USERS_MODE` is removed; `USERS_URL` is the only users configuration.

## Verification

- Users 61/61, trips 66/66, API 70/70, frontend 22/22; typechecks and production
  build pass.
- Full Compose stack: `docker compose -f deploy/docker-compose.yml up --build -d`
  built and started all ten services healthy; `scripts/smoke.ps1` passed
  (profile, users-service login, place search, agent demo suggestions).
- Helm `lint`/`test` 4/4; users and trips pods ready at revision 22.
- Playwright full UI: English default, create account, username invite, bell
  accept, protected demo users, owner-delete guard, account delete, no console
  errors.
- Migration scratch DB test covers dry-run, apply, foreign-key removal, fixed
  UUIDs and idempotent rerun.
- Local image digests (single-host build; CI publish digests pending):
  - users `0.1.0` `sha256:0c8fbc9941f91e82abceb53bd006552420ef7229789a63a0c5ea319cfc2dad9a`
  - trips `0.1.1` `sha256:7bbff00deff78f710ed57d6c0bcad11bfd94d64dc43d29eee514d017bd81f344`
  - API `1.3.0` `sha256:a7cd708c8aeb506b006492877ff4401b0f8614b0f74ca94507758496db98ecbd`
  - web `1.3.0` `sha256:d60e2ae20079ccc975bd38b6fe58a02b568ee7103804f6f079e7a7060e720121`

## Pending before publish

- Push/merge to `main` or a `v1.4.0` tag so the per-service workflows publish
  the multi-arch images (users workflow is new).
- Run the published-stack smoke (login with `demo`/`demo123`, username invite →
  bell → accept).
- The local Helm release currently overrides users/trips to the pre-publish
  `0.1.0-dev1` / `0.1.1-dev1` tags; after publication run `helm upgrade` with
  `images.users.tag=0.1.0` and `images.trips.tag=0.1.1` (or reset values).
- macOS clean-clone QA remains pending.

## Rollback

Restore the platform/trips backups, redeploy the previous API/web images and
restore the platform `users`/`notifications` tables if the decommission already
ran. The users service database is additive. See
`docs/migrations/0009-users-cutover.md`.
