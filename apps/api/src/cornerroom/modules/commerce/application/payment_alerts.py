"""New-payment alert for finance staff (owner, 2026-10-25, D-PAYALERT-01).

When a buyer sends the transaction ID of a Bangla QR payment, one email goes to the address in
`PAYMENT_ALERT_EMAIL` (empty = off) with what staff need to find it in the bKash merchant app, and
a link to the staff console. The email never confirms anything: confirming stays a signed-in staff
action on the site, with its permission check and audit (a link that confirmed by itself could be
opened by mail scanners, link tracking or anyone the email reaches).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.logging import mask_email
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.events import PAYMENT_SUBMITTED, DomainEvent

log = structlog.get_logger("commerce.payment_alerts")

# Bangladesh has no daylight saving: Dhaka is always UTC+6.
DHAKA = timezone(timedelta(hours=6), "Dhaka")

PAID_WITH = {"BKASH": "bKash", "NAGAD": "Nagad", "ROCKET": "Rocket", "UPAY": "Upay", "BANK_APP": "Bank app", "OTHER": "Other"}
PURPOSE = {"TICKET": "Tickets", "TRACK": "Song", "RELEASE": "Release"}


def _amount(amount_minor: int, currency_code: str) -> str:
    major, minor = divmod(abs(amount_minor), 100)
    return f"{'-' if amount_minor < 0 else ''}{currency_code} {major:,}.{minor:02d}"


def build_payment_alert(
    *,
    amount_minor: int,
    currency_code: str,
    transaction_ref: str,
    paid_with: str,
    paid_from: str,
    buyer_email: str | None,
    purpose: str | None,
    submitted_at: datetime,
    web_base_url: str,
) -> tuple[str, str]:
    """Subject and plain-text body. The buyer's email is masked, as on the staff screen."""
    amount = _amount(amount_minor, currency_code)
    when = submitted_at.astimezone(DHAKA).strftime("%d %b %Y, %I:%M %p")
    link = f"{web_base_url.rstrip('/')}/staff/commerce#payment-checks-title"
    subject = f"New payment to check: {amount}, TrxID {transaction_ref}"
    body = "\n".join(
        [
            "A buyer sent a payment to check.",
            "",
            f"Amount: {amount}",
            f"Transaction ID: {transaction_ref}",
            f"Paid with: {PAID_WITH.get(paid_with, paid_with)}, from {paid_from}",
            f"For: {PURPOSE.get(purpose or '', purpose or 'Order')}",
            f"Buyer: {mask_email(buyer_email)}",
            f"Sent: {when} (Dhaka time)",
            "",
            "Find it in the merchant app, then confirm or reject it on Corner Room (sign in as finance staff):",
            link,
            "",
            "This email cannot confirm a payment by itself.",
        ]
    )
    return subject, body


async def consume_payment_alert_event(event: DomainEvent, session: AsyncSession, settings: Settings | None = None) -> None:
    """Outbox side consumer: email finance staff when a buyer sends a transaction ID."""
    if event.event_type != PAYMENT_SUBMITTED:
        return
    settings = settings or get_settings()
    to = settings.payment_alert_email.strip()
    if not to:
        return
    from uuid import UUID

    from cornerroom.modules.commerce.domain.models import Order
    from cornerroom.modules.finance.domain.models_payments import Payment, PaymentSubmission
    from cornerroom.modules.identity.domain.models import User
    from cornerroom.modules.notifications.infra.email import email_sender_for

    payload = event.payload or {}
    submission = await session.get(PaymentSubmission, UUID(str(payload.get("submission_id"))))
    payment = await session.get(Payment, event.aggregate_id)
    if submission is None or payment is None:
        log.warning("payment_alert_skipped", reason="not_found", event_id=str(event.event_id))
        return
    order = await session.get(Order, submission.order_id) if submission.order_id else None
    buyer = await session.get(User, submission.user_id)
    subject, body = build_payment_alert(
        amount_minor=payment.amount_minor,
        currency_code=payment.currency_code,
        transaction_ref=submission.transaction_ref,
        paid_with=submission.paid_with,
        paid_from=submission.paid_from,
        buyer_email=buyer.email if buyer else None,
        purpose=order.purpose if order else None,
        submitted_at=submission.created_at or event.occurred_at,
        web_base_url=settings.web_base_url,
    )
    sender = email_sender_for(settings)
    if sender is None:
        log.warning("payment_alert_skipped", reason="no_email_provider", event_id=str(event.event_id))
        return
    # A failed send raises, so the outbox retries the event (the other consumers are idempotent).
    await sender.send(to=to, subject=subject, body=body)
    log.info("payment_alert_sent", to=mask_email(to), submission_id=str(submission.id))
