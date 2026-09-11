"""Channel ports. Domain modules must not send SMTP/SMS/push themselves."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID


class EmailSender(Protocol):
    async def send(self, *, to: str, subject: str, body: str, locale: str = "en") -> str | None: ...


class SmsSender(Protocol):
    async def send(self, *, to: str, body: str, locale: str = "en") -> str | None: ...


class PushSender(Protocol):
    async def send(self, *, user_id: UUID, title: str, body: str) -> str | None: ...
