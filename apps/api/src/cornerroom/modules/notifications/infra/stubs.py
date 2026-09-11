"""Stub channel adapters — log only. No vendor SDKs in Phase 0."""

from __future__ import annotations

from uuid import UUID

import structlog

log = structlog.get_logger("notifications")


class StubEmailSender:
    async def send(self, *, to: str, subject: str, body: str, locale: str = "en") -> str | None:
        log.info("email_stub", to=to, subject=subject, locale=locale)
        return "stub-email"


class StubSmsSender:
    async def send(self, *, to: str, body: str, locale: str = "en") -> str | None:
        log.info("sms_stub", to=to, locale=locale)
        return "stub-sms"


class StubPushSender:
    async def send(self, *, user_id: UUID, title: str, body: str) -> str | None:
        log.info("push_stub", user_id=str(user_id), title=title)
        return "stub-push"
