"""Day-plan block parsing and validation (M1).

The agent answers with a visible summary followed by a `````plan```` JSON block.
This module extracts that block and normalizes it into a list of plan entries
ready for the frontend. It is intentionally dependency-free (no LLM/backend
calls) so it can be verified in isolation with synthetic data.
"""

from __future__ import annotations

import json
import re
from typing import Any

_PLAN_BLOCK_RE = re.compile(r"```plan\s*\n(.*?)```", re.DOTALL)

# HH:MM between 07:00 and 23:00 (inclusive of 07:00..23:59, per the spec's regex).
_START_TIME_RE = re.compile(r"^(0[7-9]|1[0-9]|2[0-3]):[0-5][0-9]$")


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _valid_start_time(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if _START_TIME_RE.match(text) else None


def _as_cost(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_plan_block(answer: str) -> list[dict[str, Any]]:
    """Extract and validate the ```plan JSON array from the agent answer.

    Returns an empty list when the block is absent or malformed. Each returned
    entry always has ``placeId``, ``title``, ``category``, ``cost`` and
    ``startTime``. Entries without a ``placeId`` or ``title`` are dropped, and
    ``startTime`` becomes ``None`` when it is missing or outside 07:00-23:00.
    """
    if not answer:
        return []

    match = _PLAN_BLOCK_RE.search(answer)
    if not match:
        return []

    raw = match.group(1).strip()
    if not raw:
        return []

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        return []

    if not isinstance(data, list):
        return []

    entries: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        place_id = _as_str(item.get("placeId"))
        title = _as_str(item.get("title"))
        if not place_id or not title:
            continue
        entries.append(
            {
                "placeId": place_id,
                "title": title,
                "category": _as_str(item.get("category")) or "activity",
                "cost": _as_cost(item.get("cost")),
                "startTime": _valid_start_time(item.get("startTime")),
            }
        )

    return entries
