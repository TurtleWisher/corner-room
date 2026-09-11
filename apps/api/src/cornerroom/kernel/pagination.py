"""Cursor pagination helpers (opaque, not offset). Architecture: 04_API_ARCHITECTURE.md."""

from __future__ import annotations

import base64
import json
from typing import Any
from uuid import UUID

DEFAULT_LIMIT = 50
MAX_LIMIT = 100


def clamp_limit(limit: int | None, *, default: int = DEFAULT_LIMIT, maximum: int = MAX_LIMIT) -> int:
    if limit is None:
        return default
    return max(1, min(limit, maximum))


def encode_cursor(occurred_at_iso: str, entity_id: UUID) -> str:
    payload = json.dumps({"t": occurred_at_iso, "id": str(entity_id)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode()


def decode_cursor(cursor: str) -> dict[str, Any]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    data = json.loads(raw)
    if "t" not in data or "id" not in data:
        raise ValueError("invalid cursor")
    return data
