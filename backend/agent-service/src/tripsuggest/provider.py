"""LLM provider factory for the Triplanner agent.

One setting selects the model: ``LLM_PROVIDER`` = none | deepseek | openai |
anthropic | ollama. With ``none`` the agent uses a deterministic, offline demo
answer instead of calling a model.
"""

from __future__ import annotations

from typing import Any

from agno.models.anthropic import Claude
from agno.models.deepseek import DeepSeek
from agno.models.message import Message
from agno.models.openai import OpenAIChat

from tripsuggest.settings import get_settings

SMOKE_PROMPT = "Responde exactamente: AGENT_SMOKE_OK"
DEMO_PROVIDERS = {"", "none", "demo"}
PROVIDER_DEFAULT_MODELS = {
    "deepseek": "deepseek-v4-pro",
    "openai": "gpt-4o-mini",
    "anthropic": "claude-sonnet-4-5-20250929",
    "ollama": "llama3.1",
}


def is_demo_provider() -> bool:
    return get_settings().llm_provider in DEMO_PROVIDERS


def effective_model_name() -> str:
    settings = get_settings()
    return settings.llm_model or PROVIDER_DEFAULT_MODELS.get(settings.llm_provider, "")


def make_model() -> Any | None:
    """Return the configured Agno model, or ``None`` for demo mode."""
    settings = get_settings()
    provider = settings.llm_provider
    if provider in DEMO_PROVIDERS:
        return None

    key = settings.llm_api_key
    model = settings.llm_model
    base_url = settings.llm_base_url

    if provider == "deepseek":
        if not key:
            raise ValueError("LLM_API_KEY requerida para LLM_PROVIDER=deepseek")
        return DeepSeek(
            id=model or "deepseek-v4-pro",
            api_key=key,
            base_url=base_url or "https://api.deepseek.com",
        )
    if provider == "openai":
        if not key:
            raise ValueError("LLM_API_KEY requerida para LLM_PROVIDER=openai")
        return OpenAIChat(
            id=model or "gpt-4o-mini",
            api_key=key,
            base_url=base_url or None,
        )
    if provider == "anthropic":
        if not key:
            raise ValueError("LLM_API_KEY requerida para LLM_PROVIDER=anthropic")
        return Claude(id=model or "claude-sonnet-4-5-20250929", api_key=key)
    if provider == "ollama":
        # Ollama exposes an OpenAI-compatible endpoint at /v1.
        return OpenAIChat(
            id=model or "llama3.1",
            api_key=key or "ollama",
            base_url=base_url or "http://host.docker.internal:11434/v1",
        )

    raise ValueError(
        f"LLM_PROVIDER no válido: {provider!r}. Usa none, deepseek, openai, anthropic u ollama."
    )


def smoke() -> str:
    """One short completion to confirm the provider works (demo returns OK)."""
    model = make_model()
    if model is None:
        return "AGENT_SMOKE_OK"
    response = model.response([Message(role="user", content=SMOKE_PROMPT)])
    return (response.content or "").strip()
