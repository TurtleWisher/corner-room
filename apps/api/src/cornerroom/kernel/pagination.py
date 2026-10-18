"""Cursor pagination helpers (opaque, not offset). Architecture: 04_API_ARCHITECTURE.md."""

from __future__ import annotations

import base64
import binascii
import json
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, or_
from sqlalchemy.sql.elements import ColumnElement

DEFAULT_LIMIT = 50
MAX_LIMIT = 100


class InvalidCursorError(ValueError):
    """A client-supplied cursor that cannot be decoded. Mapped to a 422 problem response."""


def clamp_limit(limit: int | None, *, default: int = DEFAULT_LIMIT, maximum: int = MAX_LIMIT) -> int:
    if limit is None:
        return default
    return max(1, min(limit, maximum))


def encode_cursor(occurred_at_iso: str, entity_id: UUID) -> str:
    payload = json.dumps({"t": occurred_at_iso, "id": str(entity_id)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode()


def decode_cursor(cursor: str) -> dict[str, Any]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        data = json.loads(raw)
    except (binascii.Error, UnicodeError, ValueError) as exc:
        raise InvalidCursorError("invalid cursor") from exc
    if not isinstance(data, dict) or "t" not in data or "id" not in data:
        raise InvalidCursorError("invalid cursor")
    return data


def decode_keyset(cursor: str) -> tuple[datetime, UUID]:
    """The (timestamp, id) position a cursor from ``encode_cursor`` points at."""
    data = decode_cursor(cursor)
    try:
        moment = datetime.fromisoformat(str(data["t"]))
        entity_id = UUID(str(data["id"]))
    except ValueError as exc:
        raise InvalidCursorError("invalid cursor") from exc
    return moment, entity_id


def keyset_before(time_col: Any, id_col: Any, cursor: str) -> ColumnElement[bool]:
    """Rows after the cursor for a list ordered by ``(time_col DESC, id_col DESC)``.

    The id tiebreak keeps rows that share a timestamp across a page boundary from being skipped.
    """
    moment, entity_id = decode_keyset(cursor)
    return or_(time_col < moment, and_(time_col == moment, id_col < entity_id))
