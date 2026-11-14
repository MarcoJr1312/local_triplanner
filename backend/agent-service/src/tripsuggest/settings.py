"""Runtime configuration for the agent service.

Local runner: configuration comes from the environment or a local ``.env``.
No Firebase and no AWS secret lookups.
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
    return _env("DATABASE_URL") or "postgres://triplanner:triplanner@127.0.0.1:5432/triplanner"


@dataclass(frozen=True)
class Settings:
    """Configuration values, resolved once at import time.

    Attributes:
        deepseek_api_key: DeepSeek API key (OpenAI-compatible). Optional in demo mode.
        internal_token: Shared secret for internal agent endpoints.
        llm_base_url: OpenAI-compatible base URL.
        llm_model: Model id.
        database_url: Postgres connection string (pgvector).
        backend_url: Internal backend base URL.
    """

    deepseek_api_key: str
    internal_token: str
    llm_base_url: str
    llm_model: str
    database_url: str
    backend_url: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            deepseek_api_key=_env("DEEPSEEK_API_KEY"),
            internal_token=_env("INTERNAL_TOKEN"),
            llm_base_url=_env("AGENT_LLM_BASE_URL", "https://api.deepseek.com"),
            llm_model=_env("AGENT_LLM_MODEL", "deepseek-v4-pro"),
            database_url=_resolve_database_url(),
            backend_url=_env("BACKEND_URL", "http://127.0.0.1:4000"),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()
