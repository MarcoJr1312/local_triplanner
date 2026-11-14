"""DeepSeek provider configuration for Agno (M1: config + smoke only).

The agent itself is wired up in M3; here we only build the Agno model that
points at DeepSeek's OpenAI-compatible endpoint and prove it answers.

``agno.models.deepseek.DeepSeek`` is an ``OpenAILike`` (OpenAI-compatible)
subclass that additionally handles DeepSeek's thinking mode (``reasoning_content``)
for the v4 models, so it is preferred over a bare ``OpenAILike``.
"""

from __future__ import annotations

from agno.models.deepseek import DeepSeek
from agno.models.message import Message

from tripsuggest.settings import get_settings

SMOKE_PROMPT = "Responde exactamente: AGENT_SMOKE_OK"


def make_model() -> DeepSeek:
    """Return the Agno model pointing at DeepSeek's OpenAI-compatible API."""
    settings = get_settings()
    return DeepSeek(
        id=settings.llm_model,
        api_key=settings.deepseek_api_key,
        base_url=settings.llm_base_url,
    )


def smoke() -> str:
    """One short completion to confirm key + endpoint + model id work."""
    model = make_model()
    response = model.response([Message(role="user", content=SMOKE_PROMPT)])
    return response.content.strip()
