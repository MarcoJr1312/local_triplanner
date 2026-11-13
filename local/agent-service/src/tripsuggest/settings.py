"""Runtime configuration for the agent service.

Secrets come only from the environment (or a local ``.env`` file) and are
never hardcoded. Field names follow the repo's existing convention
(``DEEPSEEK_API_KEY``, ``FIREBASE_PROJECT_ID``, ...).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _resolve_database_url() -> str:
    """DATABASE_URL locally; in ECS, compose it from the RDS-managed secret."""
    explicit = _env("DATABASE_URL")
    if explicit:
        return explicit

    secret_arn = _env("DB_SECRET_ARN")
    if not secret_arn:
        return "postgres://triplanner:triplanner@localhost:5432/triplanner"

    import json
    from urllib.parse import quote

    import boto3

    host = _env("DB_HOST")
    if not host:
        raise RuntimeError("DB_HOST is required when DB_SECRET_ARN is set")
    client = boto3.client("secretsmanager", region_name=_env("AWS_REGION", "us-east-1"))
    secret = json.loads(client.get_secret_value(SecretId=secret_arn)["SecretString"])
    user = quote(str(secret.get("username", "")), safe="")
    password = quote(str(secret.get("password", "")), safe="")
    database = _env("DB_NAME", "postgres")
    port = _env("DB_PORT", "5432")
    return f"postgres://{user}:{password}@{host}:{port}/{database}?sslmode=require"


@dataclass(frozen=True)
class Settings:
    """Configuration values, resolved once at import time.

    Attributes:
        deepseek_api_key: DeepSeek API key (OpenAI-compatible). Never logged.
        internal_token: Shared secret for internal agent endpoints (M2+).
        firebase_service_account_path: Path to the Firebase Admin SDK service
            account JSON. Falls back to ``FIREBASE_SERVICE_ACCOUNT_PATH`` for
            consistency with the local backend, then to the repo default.
        firebase_project_id: Firebase project whose tokens this service verifies.
        llm_base_url: DeepSeek OpenAI-compatible base URL.
        llm_model: DeepSeek model id.
    """

    deepseek_api_key: str
    internal_token: str
    firebase_service_account_path: str
    firebase_project_id: str
    llm_base_url: str
    llm_model: str
    demo_mode: bool
    database_url: str

    @classmethod
    def from_env(cls) -> "Settings":
        service_account_path = (
            _env("AGENT_FIREBASE_SERVICE_ACCOUNT_PATH")
            or _env("FIREBASE_SERVICE_ACCOUNT_PATH")
            or "firebase-service-account.json"
        )
        return cls(
            deepseek_api_key=_env("DEEPSEEK_API_KEY"),
            internal_token=_env("INTERNAL_TOKEN"),
            firebase_service_account_path=service_account_path,
            firebase_project_id=_env("FIREBASE_PROJECT_ID", "triplanner-a0e06"),
            llm_base_url=_env("AGENT_LLM_BASE_URL", "https://api.deepseek.com"),
            llm_model=_env("AGENT_LLM_MODEL", "deepseek-v4-pro"),
            demo_mode=_env("AGENT_DEMO_MODE", "true").lower() != "false",
            database_url=_resolve_database_url(),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()
