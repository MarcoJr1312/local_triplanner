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
        llm_provider: ``none`` (deterministic demo), ``deepseek``, ``openai``,
            ``anthropic`` or ``ollama``.
        llm_api_key: Provider key. Falls back to ``DEEPSEEK_API_KEY``.
        llm_base_url: Provider base URL (OpenAI-compatible or Ollama ``/v1``).
        llm_model: Model id for the selected provider.
        internal_token: Shared secret for internal agent endpoints.
        database_url: Postgres connection string (pgvector).
        backend_url: Internal backend base URL.
    """

    llm_provider: str
    llm_api_key: str
    llm_base_url: str
    llm_model: str
    internal_token: str
    database_url: str
    backend_url: str

    @classmethod
    def from_env(cls) -> "Settings":
        provider = _env("LLM_PROVIDER", "none").lower() or "none"
        return cls(
            llm_provider=provider,
            llm_api_key=_env("LLM_API_KEY") or _env("DEEPSEEK_API_KEY"),
            llm_base_url=_env("LLM_BASE_URL") or _env("AGENT_LLM_BASE_URL"),
            llm_model=_env("LLM_MODEL") or _env("AGENT_LLM_MODEL"),
            internal_token=_env("INTERNAL_TOKEN"),
            database_url=_resolve_database_url(),
            backend_url=_env("BACKEND_URL", "http://127.0.0.1:4000"),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()
