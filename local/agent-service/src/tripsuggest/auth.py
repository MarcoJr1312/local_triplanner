"""Firebase Bearer token verification (M1).

Choice: ``firebase_admin`` + the existing Admin SDK service account, rather
than hand-rolling RS256/JWKS validation with ``google-auth``.

Rationale:
- ``firebase_admin.auth.verify_id_token`` already does everything required
  (JWKS download + cache, RS256 signature, ``aud == project_id``,
  ``iss == https://securetoken.google.com/<project>``, ``exp``) and reuses the
  service account file the repo already ships (``local/firebase-service-account.json``,
  gitignored). No new keys, no new dependencies beyond ``firebase-admin``.
- A ``google-auth``-only path would need manual JWKS fetching plus manual
  ``iss``/``exp`` checks, which is more code and easier to get subtly wrong.
"""

from __future__ import annotations

import os
from typing import Any

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials

from tripsuggest.settings import get_settings

_APP_NAME = "tripsuggest"
_app: firebase_admin.App | None = None


class TokenVerificationError(Exception):
    """Raised when a Bearer token cannot be verified."""


def _get_app() -> firebase_admin.App:
    """Return (and lazily initialize) the named Firebase app."""
    global _app
    if _app is None:
        path = get_settings().firebase_service_account_path
        if not os.path.isfile(path):
            raise TokenVerificationError(
                "firebase service account not found; set "
                "AGENT_FIREBASE_SERVICE_ACCOUNT_PATH"
            )
        cred = credentials.Certificate(path)
        _app = firebase_admin.initialize_app(cred, name=_APP_NAME)
    return _app


def verify_firebase_token(token: str) -> dict[str, Any]:
    """Verify a Firebase ID token and return ``{uid, email}``.

    Raises :class:`TokenVerificationError` if the token is missing, malformed,
    expired or has a wrong audience/issuer.
    """
    if not token:
        raise TokenVerificationError("missing token")
    try:
        decoded = firebase_auth.verify_id_token(token, app=_get_app())
    except TokenVerificationError:
        raise
    except Exception as exc:  # firebase_admin raises several exception types
        raise TokenVerificationError("invalid token") from exc
    uid = decoded.get("uid")
    if not uid:
        raise TokenVerificationError("token missing uid")
    return {"uid": uid, "email": decoded.get("email")}
