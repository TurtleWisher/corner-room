"""Channel ports. Domain modules must not send SMTP/SMS/push themselves."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID


class EmailSender(Protocol):
    # `from_name` replaces the name on the From line (the address stays Corner Room's), e.g.
    # "MIZULS via Corner Room" on artists' emails (D-MAIL-01).
    async def send(
        self, *, to: str, subject: str, body: str, locale: str = "en", from_name: str | None = None,
        html: str | None = None,
    ) -> str | None: ...


class SmsSender(Protocol):
    async def send(self, *, to: str, body: str, locale: str = "en") -> str | None: ...


class PushSender(Protocol):
    async def send(self, *, user_id: UUID, title: str, body: str) -> str | None: ...
