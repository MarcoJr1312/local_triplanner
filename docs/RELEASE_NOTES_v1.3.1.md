# Triplanner Local Recruiter Demo — v1.3.1

**Tag:** `v1.3.1`
**Date:** 2026-11-21
**Chart:** `helm-triplanner` 0.6.1

Patch release for the Helm email path.

## Fix

- Published `marcojr13/triplanner-email:0.1.1` (+ `latest`), manifest
  `sha256:e5319f4c28d779cf8237d408230a43517227d7cda10765bbb6db2e660c8ef3de`
  (`linux/amd64` + `linux/arm64`), with `email.member.joined.v1` parsing and
  the Spanish/English owner notification template.
- Chart 0.6.1 uses `images.email.tag: 0.1.1`.

The previous email image (`0.1.0`) treated the new joined event as unsupported
and dead-lettered it. The invite email was unaffected.

## Verification

- Invite email sent through `triplanner-kafka` → `triplanner-email` (sink).
- Member-joined event replayed with `db:replay-outbox`; the email service logged
  `email.sent` for `email.member.joined.v1` to the owner; outbox pending 0.
- Helm release revision 19; `triplanner-email:0.1.1` pod 2/2 Running.

## Upgrade

```bash
helm upgrade triplanner ./helm/helm-triplanner -n triplanner --wait
```

If an event was already dead-lettered before the upgrade, replay its outbox row:

```bash
kubectl -n triplanner exec deploy/triplanner-trips -c trips -- \
  bun run db:replay-outbox <outbox-id>
```
