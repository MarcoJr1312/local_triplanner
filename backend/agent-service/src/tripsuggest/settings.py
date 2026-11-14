"""Runtime configuration for the agent service.

Local runner: environment values are the defaults; a recruiter can override the
LLM provider from the app. The override is stored in the agent volume
(``.data/llm.json``) and is never returned to the browser.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

VALID_PROVIDERS = {"none", "deepseek", "openai", "anthropic", "ollama"}
SETTINGS_FILE = Path(
    os.getenv(
        "LLM_SETTINGS_FILE",
        str(Path(__file__).resolve().parents[2] / ".data" / "llm.json"),
    )
)


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _load_override() -> dict[str, str]:
    try:
        raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    result: dict[str, str] = {}
    for key in ("provider", "api_key", "model", "base_url"):
        value = raw.get(key)
        if value is not None:
            result[key] = str(value).strip()
    provider = result.get("provider", "").lower()
    if provider in VALID_PROVIDERS:
        result["provider"] = provider
    else:
        result.pop("provider", None)
    return result


_OVERRIDE: dict[str, str] = _load_override()


def override_snapshot() -> dict[str, str]:
    return dict(_OVERRIDE)


def update_override(
    *,
    provider: str,
    api_key: str = "",
    model: str = "",
    base_url: str = "",
    clear_key: bool = False,
) -> dict[str, str]:
    """Persist an LLM override and clear the cached settings.

    An existing key is kept when the provider does not change and the key field
    is left blank. That includes a key supplied by the environment: in that case
    the override does not copy the secret to disk, and the environment fallback
    stays in effect. Changing provider without a new key starts with no key.
    """
    global _OVERRIDE

    next_provider = (provider or "none").strip().lower() or "none"
    if next_provider not in VALID_PROVIDERS:
        raise ValueError(
            "LLM_PROVIDER no válido. Usa none, deepseek, openai, anthropic u ollama."
        )

    current = get_settings()
    previous_provider = current.llm_provider
    previous_override_key = _OVERRIDE.get("api_key", "")
    next_key = "" if clear_key or next_provider == "none" else api_key.strip()
    keep_override_key = False
    if not next_key and not clear_key and next_provider == previous_provider:
        if previous_override_key:
            next_key = previous_override_key
            keep_override_key = True
        else:
            next_key = current.llm_api_key
    if next_provider in {"deepseek", "openai", "anthropic"} and not next_key:
        raise ValueError(f"API key requerida para el proveedor {next_provider}.")

    next_data = {
        "provider": next_provider,
        "model": (model or "").strip(),
        "base_url": (base_url or "").strip(),
    }
    if next_key and (api_key.strip() or keep_override_key):
        next_data["api_key"] = next_key
    elif clear_key or next_provider in {"none", "ollama"}:
        # Explicitly clear the override so a stale env key cannot leak in.
        next_data["api_key"] = ""
    _OVERRIDE = next_data

    try:
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps(next_data, indent=2), encoding="utf-8")
        os.chmod(SETTINGS_FILE, 0o600)
    except OSError:
        # In-memory override still works when the volume is read-only.
        pass

    get_settings.cache_clear()
    return dict(next_data)


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
        provider = (
            _OVERRIDE.get("provider")
            or _env("LLM_PROVIDER", "none").lower()
            or "none"
        )
        api_key = (
            _OVERRIDE["api_key"]
            if "api_key" in _OVERRIDE
            else (_env("LLM_API_KEY") or _env("DEEPSEEK_API_KEY"))
        )
        base_url = (
            _OVERRIDE["base_url"]
            if "base_url" in _OVERRIDE
            else (_env("LLM_BASE_URL") or _env("AGENT_LLM_BASE_URL"))
        )
        model = (
            _OVERRIDE["model"]
            if "model" in _OVERRIDE
            else (_env("LLM_MODEL") or _env("AGENT_LLM_MODEL"))
        )
        return cls(
            llm_provider=provider,
            llm_api_key=api_key,
            llm_base_url=base_url,
            llm_model=model,
            internal_token=_env("INTERNAL_TOKEN"),
            database_url=_resolve_database_url(),
            backend_url=_env("BACKEND_URL", "http://127.0.0.1:4000"),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()
