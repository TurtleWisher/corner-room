"""Real email delivery over SMTP (OD-08: owner chose Brevo, 2026-10-22; any SMTP relay works).

Plain standard-library SMTP with STARTTLS, run in a thread so it never blocks the event loop.
Which sender a process uses is decided once, in `email_sender_for`: the local dev mailbox on
this machine and in tests, SMTP when it is configured, otherwise none (production without a
provider sends nothing rather than pretending).
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid

import structlog

from cornerroom.infra.logging import mask_email
from cornerroom.infra.settings import Settings
from cornerroom.modules.notifications.application.ports import EmailSender
from cornerroom.modules.notifications.infra.stubs import DevMailboxEmailSender

log = structlog.get_logger("notifications")


class SmtpEmailSender:
    def __init__(self, settings: Settings) -> None:
        self.host = settings.smtp_host
        self.port = settings.smtp_port
        self.username = settings.smtp_username
        self.password = settings.smtp_password
        self.sender = settings.email_from
        self.timeout = settings.smtp_timeout_seconds

    def _send_now(self, message: EmailMessage) -> None:
        with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if self.username:
                smtp.login(self.username, self.password or "")
            smtp.send_message(message)

    async def send(self, *, to: str, subject: str, body: str, locale: str = "en") -> str | None:
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = to
        message["Subject"] = subject
        message_id = make_msgid(domain=self.sender.rsplit("@", 1)[-1].strip("> ") or None)
        message["Message-ID"] = message_id
        message.set_content(body)
        await asyncio.to_thread(self._send_now, message)
        # Recipients are personal data: logs carry a masked address only.
        log.info("email_sent", to=mask_email(to), subject=subject, locale=locale)
        return message_id


def email_sender_for(settings: Settings) -> EmailSender | None:
    """The one place that picks how email leaves this process."""
    if settings.uses_dev_mailbox:
        return DevMailboxEmailSender(settings.dev_mailbox_path)
    if settings.smtp_configured:
        return SmtpEmailSender(settings)
    return None
