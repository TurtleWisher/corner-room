"""Stub channel adapters — log only. No vendor SDKs in Phase 0."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import structlog

from cornerroom.infra.logging import mask_email, mask_phone

log = structlog.get_logger("notifications")


class StubEmailSender:
    async def send(self, *, to: str, subject: str, body: str, locale: str = "en") -> str | None:
        # Recipients are personal data: logs carry a masked address only.
        log.info("email_stub", to=mask_email(to), subject=subject, locale=locale)
        return "stub-email"


class StubSmsSender:
    async def send(self, *, to: str, body: str, locale: str = "en") -> str | None:
        log.info("sms_stub", to=mask_phone(to), locale=locale)
        return "stub-sms"


class StubPushSender:
    async def send(self, *, user_id: UUID, title: str, body: str) -> str | None:
        log.info("push_stub", user_id=str(user_id), title=title)
        return "stub-push"


class DevMailboxEmailSender:
    """Local/dev/test only: append each email to a JSON-lines file and log it. Never used in production.

    Stands in for a transactional email provider until one is chosen (OD-08 / Q-P2-verify-delivery).
    """

    def __init__(self, path: str) -> None:
        self.file = Path(path) / "mailbox.jsonl"

    async def send(self, *, to: str, subject: str, body: str, locale: str = "en") -> str | None:
        self.file.parent.mkdir(parents=True, exist_ok=True)
        record = {"at": datetime.now(timezone.utc).isoformat(), "to": to, "subject": subject, "body": body, "locale": locale}
        with self.file.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
        log.info("email_dev_mailbox", to=mask_email(to), subject=subject, file=str(self.file))
        return "dev-mailbox"
