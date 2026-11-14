"""Runtime LLM settings tests (no database, no network).

Run without pytest:

    cd backend/agent-service && uv run python tests/test_settings.py
"""

from __future__ import annotations

import json
import os
import tempfile
import traceback
from pathlib import Path
from typing import Callable

_tmp = tempfile.TemporaryDirectory()
SETTINGS_PATH = Path(_tmp.name) / "llm.json"
os.environ["LLM_SETTINGS_FILE"] = str(SETTINGS_PATH)
os.environ["LLM_PROVIDER"] = "none"
for _name in ("LLM_API_KEY", "DEEPSEEK_API_KEY", "LLM_MODEL", "LLM_BASE_URL"):
    os.environ.pop(_name, None)

from tripsuggest import settings as llm_settings  # noqa: E402


def _reset() -> None:
    llm_settings._OVERRIDE = {}
    llm_settings.get_settings.cache_clear()
    SETTINGS_PATH.unlink(missing_ok=True)


def test_defaults_to_demo() -> None:
    _reset()
    settings = llm_settings.get_settings()
    assert settings.llm_provider == "none"
    assert settings.llm_api_key == ""
    assert not SETTINGS_PATH.exists()


def test_ollama_persists_without_key() -> None:
    _reset()
    llm_settings.update_override(
        provider="ollama",
        model="llama3.1",
        base_url="http://host.docker.internal:11434/v1",
    )
    settings = llm_settings.get_settings()
    assert settings.llm_provider == "ollama"
    assert settings.llm_model == "llama3.1"
    assert settings.llm_base_url == "http://host.docker.internal:11434/v1"
    saved = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    assert saved["provider"] == "ollama"
    assert saved["model"] == "llama3.1"
    assert saved["api_key"] == ""


def test_requires_key_for_hosted_providers() -> None:
    _reset()
    try:
        llm_settings.update_override(provider="deepseek")
    except ValueError:
        return
    raise AssertionError("deepseek without a key must be rejected")


def test_keeps_existing_key() -> None:
    _reset()
    llm_settings.update_override(provider="deepseek", api_key="sk-test", model="deepseek-chat")
    assert llm_settings.get_settings().llm_api_key == "sk-test"

    llm_settings.update_override(provider="deepseek", model="deepseek-chat")
    assert llm_settings.get_settings().llm_api_key == "sk-test"


def test_none_clears_key() -> None:
    _reset()
    llm_settings.update_override(provider="openai", api_key="sk-test")
    llm_settings.update_override(provider="none", clear_key=True)
    settings = llm_settings.get_settings()
    assert settings.llm_provider == "none"
    assert settings.llm_api_key == ""
    assert json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))["api_key"] == ""


def test_invalid_provider_rejected() -> None:
    _reset()
    try:
        llm_settings.update_override(provider="skynet")
    except ValueError:
        return
    raise AssertionError("unknown providers must be rejected")


def main() -> int:
    tests: list[Callable[[], None]] = [
        test_defaults_to_demo,
        test_ollama_persists_without_key,
        test_requires_key_for_hosted_providers,
        test_keeps_existing_key,
        test_none_clears_key,
        test_invalid_provider_rejected,
    ]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {test.__name__}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} tests passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
