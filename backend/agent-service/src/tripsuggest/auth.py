"""Demo identity resolution for the local runner.

No Firebase: the Next.js proxy forwards the selected demo identity as
``X-User-Id``. The default is the seeded ``demo-user``.
"""

from __future__ import annotations

DEMO_USER_ID = "11111111-1111-4111-8111-111111111111"


def resolve_demo_user(x_user_id: str | None) -> str:
    value = (x_user_id or "").strip()
    return value or DEMO_USER_ID
