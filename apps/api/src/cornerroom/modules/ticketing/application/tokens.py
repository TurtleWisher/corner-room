"""Server-authoritative ticket tokens. Secrets are hashed, never logged."""

from __future__ import annotations

import hashlib
import hmac
from uuid import UUID


def ticket_token(ticket_id: UUID, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), str(ticket_id).encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{ticket_id}.{digest}"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def parse_ticket_id(token: str) -> UUID | None:
    if "." not in token:
        return None
    raw, _, _sig = token.partition(".")
    try:
        return UUID(raw)
    except ValueError:
        return None


def verify_ticket_token(token: str, secret: str) -> UUID | None:
    ticket_id = parse_ticket_id(token)
    if ticket_id is None:
        return None
    expected = ticket_token(ticket_id, secret)
    if not hmac.compare_digest(token, expected):
        return None
    return ticket_id
