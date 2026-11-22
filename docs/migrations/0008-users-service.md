# 0008 — Users service (PostgreSQL + local invites)

| Field | Value |
|---|---|
| Status | **Proposed — pending Gate 1** |
| Integration branch | `refactor/helm` |
| Work branch | `refactor/helm-users-service` |
| Runtime | Bun + TypeScript |
| Transport | Internal HTTP/JSON, `x-internal-token`, `x-actor-id` |
| Data store | PostgreSQL 17, owned by the service |
| Depends on | nothing outbound (the API orchestrates trips) |
| Helm | `users` Deployment + `users-postgres` StatefulSet |

## 1. Summary

Extract users and local notifications out of the platform Postgres into an
independently deployable `triplanner-users` service with its own PostgreSQL.

The service owns user accounts (UUID, username, display name, optional email,
avatar URL, language) and the notification inbox used by **local trip invites**.
The API keeps the GraphQL contract, avatars bytes, favorites, interests, chats,
attachments, sessions and all composition with trips/locations/email.

The service is the authority for account existence, username lookup and the
notification inbox. The trips service remains the authority for memberships and
invitations; a new local invitation channel has no email and no outbox.

## 2. Decisions taken (2026-11-21)

1. **Fixed UUIDs + migration.** `demo-user` becomes
   `11111111-1111-4111-8111-111111111111` and `demo-friend` becomes
   `22222222-2222-4222-8222-222222222222`. All references in the platform and
   trips databases are migrated by a checked script.
2. **Delete policy.** Soft delete (`deleted_at`). Deleting a user who owns any
   trip is blocked with `USER_OWNS_TRIPS`; the trip must be transferred or
   deleted first. `demo-user` and `demo-friend` are protected forever
   (`PROTECTED_USER`).
3. **No admin role.** The recruiter can create any number of accounts. Any local
   caller with the internal token may create or delete a non-protected account;
   the API still enforces the owner guard. This is a local demo, not production
   authorization.
4. **`tripLocalInvite` is orchestrated by the API.** The users service resolves
   usernames and stores notifications; trips creates the local invitation. The
   users service does not call trips.
5. **Notification delivery: query + live subscription.** `myNotifications` on
   login/refresh plus an `onNotification` subscription for the current user.
6. **Local credentials: username + password.** Account creation requires
   username, display name and password; email is not part of creation. Passwords
   are hashed with Argon2id (`Bun.password`) and never returned. Login verifies
   the password and returns the profile; there is still **no JWT** — the browser
   keeps the returned UUID and sends `x-user-id`. Demo passwords are seeded for
   `demo`/`demo-friend` and shown in the login hint. Email remains optional in the
   table only for the migrated demo rows and the agent display; new accounts
   have none.

## 3. Scope

### In scope

- `users`: UUID, username, display name, optional email, color, avatar URL,
  language, `created_at`, `deleted_at`.
- User search, batch lookup, create, profile update, soft delete.
- `notifications`: local trip invites, read/accept/decline status.
- Local invitations in the trips service: schema, create, join, decline.
- `tripLocalInvite`, accept/decline mutations and the `onNotification`
  subscription in the API.
- Login by username, user switcher, create/delete account UI.
- Fixed-UUID migration of the platform and trips databases.
- Compose and Helm deployment of `users` + `users-postgres`.
- Decommission of the platform `users`/`notifications` tables.

### Out of scope

- Passwords, JWT, OAuth, sessions with expiry. The demo identity is the
  `x-user-id` UUID.
- Email delivery changes. The email invite path stays as it is.
- Avatar bytes. The API keeps storage; the users service stores `avatar_url`.
- Production RBAC/admin. Any local operator can create/delete.
- Multi-replica notifications. The API pubsub is in-process.

## 4. Identity model

- `users.id` is a UUID primary key.
- `username` is lowercase, 3–32 chars, unique among active users
  (`^[a-z0-9][a-z0-9_-]{2,31}$`).
- `password_hash` is required. Passwords are hashed with Argon2id
  (`Bun.password.hash`/`verify`), minimum 6 characters, and never stored or
  returned in plain text.
- `email` is optional in storage for migrated demo rows; **account creation does
  not accept email**. New accounts have `email = NULL`.
- `language` is `es` or `en`; new accounts default to `es` (product default).
- No JWT. Login is `username + password`; the users service verifies the hash
  and returns the profile. The browser stores the UUID and sends
  `x-user-id: <uuid>`; the API validates the account on profile operations and
  uses it for member enrichment.
- The header is spoofable by design. The password gates login only; this is a
  local recruiter demo, not production auth.

### 4.1 Demo identities

| User | UUID | Username | Demo password | Display name |
|---|---|---|---|---|
| demo-user | `11111111-1111-4111-8111-111111111111` | `demo` | `demo123` | Demo |
| demo-friend | `22222222-2222-4222-8222-222222222222` | `demo-friend` | `demo123` | Demo Friend |

Both are seeded idempotently by the users service and cannot be deleted. The
login screen shows the demo pair as a hint. Email is not required for either
new account; the two seeded rows may keep their legacy demo emails for display
and agent compatibility, but they are never used to authenticate.

## 5. Data ownership

| Users service | Platform Postgres (API) | Trips service |
|---|---|---|
| `users` | `item_attachments`, `attachment_viewers` | `trips`, `trip_members`, `trip_items` |
| `notifications` | `user_favorites`, `user_interests` | `invitations` (email + local) |
| | `suggestion_chats`, `agent_embeddings` | `outbox` |

`user_id`, `created_by` and `invitee_user_id` are opaque text/UUIDs outside the
users database. The platform FKs `attachment_viewers.user_id` and
`user_favorites.user_id` to `users` are dropped; the API validates through the
users service.

## 6. Users schema

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  username      text NOT NULL,
  email         text,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  color         text,
  avatar_url    text,
  language      text NOT NULL DEFAULT 'es',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower
  ON users (lower(username)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower
  ON users (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS notifications (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('trip_invite')),
  trip_id         text NOT NULL,
  trip_name       text NOT NULL,
  invitation_id   text NOT NULL,
  inviter_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  role            text NOT NULL CHECK (role IN ('editor', 'viewer')),
  status          text NOT NULL DEFAULT 'unread'
                    CHECK (status IN ('unread', 'read', 'accepted', 'declined')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_invitation
  ON notifications(user_id, invitation_id);
```

- `trip_id` and `invitation_id` are opaque references to the trips service.
- The unique `(user_id, invitation_id)` makes invite retries idempotent.
- No outbox: local invites never send email.

## 7. Users service contract

Base `/internal/v1`, `x-internal-token` on every request, JSON, snake_case, flat
`{error, message}`. `/health` and `/ready` are unauthenticated.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health`, `/ready` | probes |
| GET | `/internal/v1/users?query=&limit=` | active user search for login/invite |
| GET | `/internal/v1/users/{id}` | profile (also returns soft-deleted for enrichment) |
| GET | `/internal/v1/users/by-username/{username}` | login + local invite |
| GET | `/internal/v1/users/by-email/{email}` | agent identity resolution (legacy demo rows) |
| POST | `/internal/v1/users/batch` | `{ids}` member/attachment enrichment |
| POST | `/internal/v1/auth/login` | `{username, password}` → profile or `INVALID_CREDENTIALS` |
| POST | `/internal/v1/users` | create `{username, password, display_name, language?}`; no email |
| PATCH | `/internal/v1/users/{id}` | self profile `{display_name?, language?, avatar_url?, color?}` |
| DELETE | `/internal/v1/users/{id}` | soft delete; protected demo UUIDs rejected |
| POST | `/internal/v1/notifications` | create a local invite notification |
| GET | `/internal/v1/users/{id}/notifications?status=&limit=` | inbox |
| PATCH | `/internal/v1/notifications/{id}` | `{status: read|accepted|declined}` |

Stable errors: `USER_NOT_FOUND`, `USERNAME_TAKEN`, `EMAIL_TAKEN`,
`INVALID_CREDENTIALS` (401), `PROTECTED_USER`, `NOTIFICATION_NOT_FOUND`,
`INVALID_ARGUMENT`, `UNAUTHORIZED`, `UNAVAILABLE`.

`PATCH /users/{id}` requires `x-actor-id` equal to `{id}` (self). Create and
delete are open to the internal token, matching the no-admin decision. Delete is
soft and the API enforces the trip-owner guard. The password is accepted only by
login and create; it is hashed immediately and never logged or returned.

## 8. Trips service changes

`invitations` gains a channel:

```sql
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'email';
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invitee_user_id text;
ALTER TABLE invitations ALTER COLUMN email DROP NOT NULL;
ALTER TABLE invitations ALTER COLUMN code DROP NOT NULL;
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_status_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'));
ALTER TABLE invitations ADD CONSTRAINT invitations_channel_fields CHECK (
  (channel = 'email' AND email IS NOT NULL AND code IS NOT NULL) OR
  (channel = 'local' AND invitee_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_local_pending
  ON invitations(trip_id, invitee_user_id)
  WHERE channel = 'local' AND status = 'pending';
```

New routes:

| Method | Path | Purpose |
|---|---|---|
| POST | `/internal/v1/trips/{id}/local-invite` | `{invitee_user_id, role, created_by}` → pending local invitation, no outbox |
| POST | `/internal/v1/trips/{id}/join-local` | `{user_id, invitation_id}` → membership + accepted in one transaction |
| POST | `/internal/v1/trips/{id}/local-invite/{invitationId}/decline` | `{user_id}` → declined |

The existing email routes (`POST /invitations`, `/invitations/by-code`,
`/join`) and the outbox are unchanged.

## 9. Local invite flow

```text
UI: invite by username
  -> API tripLocalInvite(tripId, username, role)
      -> Users GET /users/by-username/{username}
      -> Trips GET /trips/{id} (actor role; target not a member)
      -> Trips POST /trips/{id}/local-invite
      -> Users POST /notifications
      -> API publishes onNotification to the invitee
  -> invitee logs in, sees the notification
  -> acceptTripLocalInvite(notificationId)
      -> Users GET notification (target check)
      -> Trips POST /trips/{id}/join-local
      -> Users PATCH notification accepted
      -> API returns the Trip
  -> declineTripLocalInvite(notificationId)
      -> Trips decline
      -> Users PATCH notification declined
```

- The target must be an active user. Deleted/unknown usernames produce
  `USER_NOT_FOUND`; the current user cannot invite themselves.
- The API checks the actor is owner/editor and the target is not a member; the
  trips service re-checks both.
- If the notification creation fails after the trip invitation is created, the
  API calls the trips decline route as compensation and returns
  `NOTIFICATION_FAILED`.
- Accept is idempotent: a repeated call returns the trip; a declined/revoked
  invitation returns `INVITE_ALREADY_USED`.
- No email, code or outbox row is created for a local invite.

## 10. API changes

### 10.1 `UsersStore` port

`backend/server/src/users/`:

- `types.ts` — `UsersStore` port, user/notification DTOs.
- `local.ts` — platform `users` + temporary platform `notifications` tables.
- `remote.ts` — calls the users service.
- `index.ts` — factory from `USERS_MODE=local|remote` (local during the cutover
  and tests; remote in Compose/Helm).

Methods: `getUser`, `getByUsername`, `getByEmail`, `listUsers`, `batchUsers`,
`createUser`, `updateUser`, `deleteUser`, `createNotification`,
`listNotifications`, `updateNotification`.

### 10.2 GraphQL

Additive changes:

```graphql
type UserProfile {
  userId: ID!
  username: String!
  displayName: String!
  email: String
  color: String
  avatarUrl: String
  language: String
  deletedAt: AWSDateTime
}

extend type Member { username: String }

type Notification {
  id: ID!
  type: String!
  tripId: ID!
  tripName: String!
  invitationId: ID!
  inviter: UserProfile!
  role: MemberRole!
  status: String!
  createdAt: AWSDateTime!
  readAt: AWSDateTime
}

type LocalInviteResult {
  invitationId: ID!
  notificationId: ID!
  user: UserProfile!
  status: String!
}

extend type Query {
  listUsers(query: String): [UserProfile!]!
  getUserByUsername(username: String!): UserProfile
  myNotifications: [Notification!]!
}

extend type Mutation {
  login(username: String!, password: String!): UserProfile!
  createUser(input: CreateUserInput!): UserProfile!
  deleteUser(userId: ID!): Boolean!
  tripLocalInvite(tripId: ID!, username: String!, role: MemberRole!): LocalInviteResult!
  acceptTripLocalInvite(notificationId: ID!): Trip!
  declineTripLocalInvite(notificationId: ID!): Notification!
  markNotificationRead(notificationId: ID!): Notification!
}

extend type Subscription {
  onNotification: Notification!
}
```

`CreateUserInput` is `{ username, password, displayName, language? }`; there is
no email field. `login` verifies the password in the users service and returns
the profile; the client stores the UUID and sends `x-user-id` on subsequent
requests. No JWT is issued.

- `email` on `UserProfile`/`Member` becomes nullable. The frontend is updated in
  the same slice.
- `registerUser` and `findUserByEmail` are replaced by `login` / `createUser` /
  `listUsers` / `getUserByUsername`; the old fields stay deprecated for one
  release or are removed with the frontend update.
- `inviteMember` (direct add without notification) is removed from the UI; the
  local invite is the new path.
- `onNotification` subscribes to `notify:${currentUserId}`. The invite mutation
  publishes to the target after the users service stores the notification. The
  API is a single local process; multi-replica delivery is out of scope.

### 10.3 Composition updates

- `enrichMembers` uses `ctx.users.batchUsers`, not the platform `users` table.
- `requireCurrentUser`, `getMyProfile`, `updateMyProfile`, `deleteUser`,
  `getTripByCode`, `joinTripWithCode`, `sendTripInvite` and `internal.ts` use
  `ctx.users`.
- `updateMyProfile` writes avatar bytes in the API and stores the URL in users.
- Attachment `uploadedByName`, viewer validation and favorite ownership use the
  users store; the platform FKs are dropped.
- The agent's `x-user-email` resolution and `userLanguage` use the users store.

### 10.4 Delete guard

The API `deleteUser` mutation:

1. Reject `DEMO_USER_UUID` / `DEMO_FRIEND_UUID` → `PROTECTED_USER`.
2. `ctx.trips.listMyTrips(targetUserId)`; if any summary role is `owner` →
   `USER_OWNS_TRIPS`.
3. `ctx.users.deleteUser(targetUserId)` (soft).
4. Publish nothing; the user is removed from login/search.

The users service also rejects the protected UUIDs; it does not know trips.

## 11. Frontend

- **Login**: username + password form; the demo pair is shown with the demo
  password hint; create a user inline (username, display name, password) and
  delete a non-protected user. No email field. Selecting a user stores the UUID
  and profile; no password is stored after login.
- **Session**: store the UUID, username, display name, email, language; send
  `x-user-id`; update the proxy default to the demo UUID.
- **Notifications**: bell with unread count; `myNotifications` on login;
  `onNotification` subscription while signed in; accept/decline; open the trip.
- **Invite modal**: tabs **Email** (existing) and **Username** (search active
  users, choose role, `tripLocalInvite`).
- **Members**: show username/display name; `email` may be null.
- **Users admin**: create/delete from the login screen or Settings; protected
  demo users are not deletable; owner-blocked deletes show a clear message.
- Spanish default with mirrored es/en keys for every new string.

## 12. Migration and cutover

`backend/users-service/scripts/migrate-users.ts` with three URLs:
`LEGACY_DATABASE_URL` (platform), `TRIPS_DATABASE_URL`, `USERS_DATABASE_URL`.

Steps:

1. Read platform `users`; map `demo-user`/`demo-friend` to the fixed UUIDs;
   generate UUIDs for other rows; derive unique usernames from email local-part
   or display name. Set the seeded demo password hash (`demo123`); for any other
   legacy row, assign a documented temporary demo password and flag it for
   reset.
2. Insert into the users service; seed the two demo users if absent.
3. Drop `attachment_viewers.user_id` and `user_favorites.user_id` FKs.
4. Update platform references: `attachment_viewers.user_id`,
   `item_attachments.created_by`, `user_favorites.user_id`,
   `user_interests.user_id`, `suggestion_chats.user_id`,
   `agent_embeddings.user_id`.
5. Update the platform `users` table: UUID PK, add `username`/`deleted_at`, make
   `email` nullable.
6. Update trips references: `trips.owner_id`, `trip_members.user_id`,
   `trip_items.created_by`, `invitations.created_by`.
7. Verify counts/checksums and the demo trip owner/members.

The users service seed uses the fixed UUIDs; the trips seed uses the same
`demo-user` UUID. The email outbox payloads contain no user IDs.

Cutover:

- Build the users service and the API `UsersStore`; `USERS_MODE=remote` in
  Compose/Helm, `local` only for tests/rollback.
- The platform `users` table and the temporary `notifications` table remain
  until Gate 2, then are dropped with the local adapter.
- Backups: platform DB (users + FKs) and trips DB before the UUID update.

## 13. Compose and Helm

- `users-postgres`: `postgres:17`, 2Gi PVC, credentials Secret
  `triplanner-users-postgres-credentials` (`POSTGRES_USER/PASSWORD/DB`), no
  published port.
- `users`: `:4500`, own Postgres only; `/health` + `/ready`; seeds demo users.
- Helm chart 0.7.0: `usersService` block, StatefulSet, Service, Secret,
  NetworkPolicy, SA/RBAC/proxy, test hook.
- API overlay: `USERS_MODE=remote`, `USERS_URL=http://host.docker.internal:4500`.
- Port-forward helpers add users `4500`, proxy `8447`, users Postgres `5434`.
- Images: users `0.1.0`, trips `0.1.1` (local invite schema), API/web `1.3.0`,
  email unchanged `0.1.1`.

## 14. Rollout

| Stage | Name | Owner |
|---|---|---|
| M10.1 | Contract, ADR and Gate 1 | PM |
| M10.2 | Users service skeleton | Backend |
| M10.3 | Users/notifications schema, migrations and fixed-UUID seed | Backend |
| M10.4 | Users CRUD, search, batch and delete policy | Backend |
| M10.5 | Notification endpoints | Backend |
| M10.6 | Trips local invitations, join-local and decline | Backend |
| M10.7 | API `UsersStore`, profile/auth/member enrichment and platform schema | Backend |
| M10.8 | API `tripLocalInvite`, accept/decline and `onNotification` | Backend |
| M10.9 | Frontend login, users admin, notification bell and invite tabs | Backend |
| M10.10 | Fixed-UUID migration script and data copy | Backend |
| M10.11 | Compose and Helm: `users-postgres` + `users` | SRE |
| M10.12 | QA matrix, failure injection and Gate 2 | QA |
| M10.13 | Decommission platform users/notifications and local adapter | Backend |
| M10.14 | Image publish, Helm acceptance and release | SRE |

## 15. Risks

| Risk | Mitigation |
|---|---|
| Cross-DB UUID migration | Backup both DBs; mapping script with counts/checksums; dry-run |
| Dropped FKs on attachments/favorites | API validates user IDs through the users service |
| Extra users-service calls per trip | `batchUsers` once per aggregate; short in-process TTL cache |
| Header spoofing | Local demo only; the password gates login, but `x-user-id` is not production auth |
| Password handling | Argon2id hashes; never log/return; local HTTP inside the cluster only |
| Delete keeps memberships | Soft delete; members show the last display name; owner delete blocked |
| Notification/invitation divergence | Compensating decline; accept idempotent; unique `(user, invitation)` |
| Live subscription single-replica | API is one local process; shared bus is a later concern |
| Username reuse after delete | Partial unique indexes; old memberships keep the old profile |
| Users service down | API maps to `USERS_UNAVAILABLE`; login/profile fail clearly |

## 16. Acceptance evidence

- Users service tests: CRUD, username uniqueness, password login/hash,
  invalid credentials, soft delete, protected demo users, notifications.
- Trips tests: local invite create/join/decline, email path unaffected.
- API tests: local/remote `UsersStore`, profile/auth, member enrichment,
  `tripLocalInvite`, accept/decline, subscription.
- Frontend tests: login/user switch, create/delete, notification bell, invite
  tabs.
- Compose/Helm: users + users-postgres ready, demo login, local invite →
  notification → accept, fixed-UUID migration verified.
- Gate 2 decision recorded before decommission.
