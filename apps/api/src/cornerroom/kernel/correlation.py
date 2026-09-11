"""Correlation / request ID validation. Client values are not trusted blindly."""

from __future__ import annotations

import re
from uuid import uuid4

# Printable token: UUID or similar. Rejects whitespace, quotes, and control chars.
_CORRELATION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$")


def new_correlation_id() -> str:
    return str(uuid4())


def sanitize_correlation_id(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.strip()
    if not _CORRELATION_RE.fullmatch(candidate):
        return None
    return candidate


def resolve_correlation_id(*candidates: str | None) -> str:
    for candidate in candidates:
        sanitized = sanitize_correlation_id(candidate)
        if sanitized is not None:
            return sanitized
    return new_correlation_id()
