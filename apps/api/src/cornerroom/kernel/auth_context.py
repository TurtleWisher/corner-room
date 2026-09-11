"""Request actor — not a permission database."""

from __future__ import annotations

from dataclasses import dataclass, field
from uuid import UUID


@dataclass(frozen=True, slots=True)
class AuthContext:
    user_id: UUID
    request_id: str
    organization_id: UUID | None = None
    on_behalf_of_user_id: UUID | None = None
    permission_keys: frozenset[str] = field(default_factory=frozenset)
    ip: str | None = None
    user_agent: str | None = None
    actor_type: str = "user"
    session_id: UUID | None = None
