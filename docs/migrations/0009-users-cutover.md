# 0009 — Users fixed-UUID cutover runbook

| Field | Value |
|---|---|
| Status | Implemented; cluster cutover pending M10.11/QA |
| Script | `backend/users-service/scripts/migrate-users.ts` |
| Contract | [`0008-users-service.md`](./0008-users-service.md) |
| Owner | TBD |

## What moves

| Database | Tables |
|---|---|
| Platform (legacy) | `users`, `item_attachments.created_by`, `attachment_viewers.user_id`, `user_favorites.user_id`, `user_interests.user_id`, `suggestion_chats.user_id`, `agent_embeddings.user_id`, `notifications.user_id`, `notifications.inviter_user_id` |
| Trips service | `trips.owner_id`, `trip_members.user_id`, `trip_items.created_by`, `invitations.created_by`, `invitations.invitee_user_id` |
| Users service | `users` rows (new owner of identity) |

Fixed ids: `demo-user` → `11111111-1111-4111-8111-111111111111`,
`demo-friend` → `22222222-2222-4222-8222-222222222222`. Other legacy ids get a
deterministic UUID and a unique lowercase username derived from the existing
username, email or display name.

## Preconditions

1. Back up the platform and trips databases:
   ```bash
   pg_dump "$LEGACY_DATABASE_URL" -Fc -f platform-before-users.dump
   pg_dump "$TRIPS_DATABASE_URL" -Fc -f trips-before-users.dump
   ```
2. Start the users service once (or run `bun run db:migrate`) so its `users`
   and `notifications` schema exists.
3. Stop the API and the users service. The script locks the users tables and
   hashes passwords; no traffic should race the cutover.
4. Confirm the API still points at the legacy platform DB for the migration and
   that the trips service is reachable (or its DB is directly reachable).

## Dry-run

```bash
cd backend/users-service
LEGACY_DATABASE_URL=... \
TRIPS_DATABASE_URL=... \
USERS_DATABASE_URL=... \
bun scripts/migrate-users.ts
```

The report lists every `old -> new` mapping, placeholders for references that
had no platform row, and warnings (email collisions, dangling references). No
rows are written.

## Apply

```bash
APPLY=1 ... bun scripts/migrate-users.ts
```

The script:

1. Inserts missing accounts into the users service. Demo accounts use
   `demo123`; other legacy rows receive the same documented temporary demo
   password and must be reset by the recruiter. Existing hashes are preserved.
2. Drops every foreign key that points at the platform `users` table.
3. Rewrites platform references and the platform `users` primary key to UUID.
4. Rewrites trips references (including `invitations.invitee_user_id` when the
   local-invite schema is present).
5. Verifies counts, UUID format and dangling references.

Each database runs in its own transaction; the script is safe to rerun. If the
trips update fails after the platform commit, fix the trips connection and run
the same command again: UUID ids map to themselves.

## Verification

```sql
-- Platform users are UUIDs
SELECT COUNT(*) FROM users
 WHERE id::text !~
   '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

-- Demo trip owner and members
SELECT owner_id FROM trips WHERE id = 'demo-trip';
SELECT user_id, role FROM trip_members WHERE trip_id = 'demo-trip';

-- No FK remains on the dropped columns
SELECT table_name, constraint_name
  FROM information_schema.table_constraints
 WHERE constraint_type = 'FOREIGN KEY'
   AND constraint_name ILIKE '%users%';
```

Expected: `0` non-UUID ids, the demo owner is
`11111111-1111-4111-8111-111111111111`, and no FK references the platform
`users` table.

Demo login after cutover: `demo` / `demo123` and `demo-friend` / `demo123`
(users service). The API keeps `USERS_MODE=local` only as a rollback adapter.

## Rollback

Restore both dumps, redeploy the previous API image (platform ids are text
again) and point it at the restored databases. The users service database can
stay; it is additive. Do not run the old API against a partially migrated
platform DB. After M10.13 the platform `users`/`notifications` tables are gone;
a rollback must also restore them and the old local-adapter image.

## Evidence

`backend/users-service/test/migration.test.ts` creates scratch platform, trips
and users databases, applies the migration and asserts the fixed UUIDs,
references, password hashes, foreign-key removal and idempotent rerun.
