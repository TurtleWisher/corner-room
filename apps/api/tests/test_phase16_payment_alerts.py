"""New-payment alert (owner, 2026-10-25, D-PAYALERT-01): when a buyer sends a Bangla QR transaction
ID, finance staff get one email with what they need to find it, and a link to the staff console.
The email never confirms anything by itself."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from httpx import AsyncClient

from cornerroom.infra.settings import Settings
from cornerroom.kernel.events import ORDER_PAID, PAYMENT_SUBMITTED, DomainEvent
from cornerroom.modules.commerce.application.payment_alerts import build_payment_alert, consume_payment_alert_event
from tests.auth_helpers import bearer, register_and_login


def test_alert_names_the_amount_and_transaction_and_masks_the_buyer() -> None:
    subject, body = build_payment_alert(
        amount_minor=11400,
        currency_code="BDT",
        transaction_ref="8N7A6B5C4D",
        paid_with="BKASH",
        paid_from="01712 345678",
        buyer_email="nadia@example.com",
        purpose="RELEASE",
        submitted_at=datetime(2026, 10, 26, 16, 42, tzinfo=timezone.utc),
        web_base_url="https://www.cornerroom.live/",
    )
    assert subject == "New payment to check: BDT 114.00, TrxID 8N7A6B5C4D"
    assert "Paid with: bKash, from 01712 345678" in body
    assert "For: Release" in body
    assert "n***@example.com" in body and "nadia@" not in body
    assert "26 Oct 2026, 10:42 PM (Dhaka time)" in body
    # The only link is the staff console; nothing in the email confirms a payment.
    assert "https://www.cornerroom.live/staff/commerce#payment-checks-title" in body
    assert "/confirm" not in body and "token" not in body.lower()


def _event(event_type: str) -> DomainEvent:
    return DomainEvent(
        event_type=event_type,
        producer="commerce",
        aggregate_type="Payment",
        aggregate_id=uuid4(),
        payload={"submission_id": str(uuid4())},
        occurred_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_alert_is_off_without_an_address_and_ignores_other_events() -> None:
    # No session is touched in either case.
    await consume_payment_alert_event(_event(PAYMENT_SUBMITTED), None, Settings(payment_alert_email=""))  # type: ignore[arg-type]
    await consume_payment_alert_event(_event(ORDER_PAID), None, Settings(payment_alert_email="finance@example.com"))  # type: ignore[arg-type]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_a_sent_transaction_id_emails_finance_staff(client: AsyncClient, monkeypatch, tmp_path) -> None:
    from cornerroom.infra.settings import get_settings
    from cornerroom.worker import drain_outbox
    from tests.test_phase05_ticketing import _platform_admin
    from tests.test_phase09_purchases import _active_offer, _released_track
    from tests.test_phase16_bangla_qr import _submit

    staff, _org = await _platform_admin(client)
    track = await _released_track(client, staff, "Alert Song")
    offer = await _active_offer(client, staff, track["id"], 11400)
    monkeypatch.setenv("PAYMENT_PROVIDER", "bangla_qr")
    monkeypatch.setenv("PAYMENT_ALERT_EMAIL", "finance@example.com")
    monkeypatch.setenv("DEV_MAILBOX_PATH", str(tmp_path))
    get_settings.cache_clear()
    try:
        buyer = (await register_and_login(client, "alert-buyer@example.com"))["access_token"]
        order = await client.post(
            "/api/v1/orders",
            headers={**bearer(buyer), "Idempotency-Key": "alert-song"},
            json={"offer_id": offer["id"], "delivery_address_confirmed": True},
        )
        assert order.status_code == 201, order.text
        assert (await _submit(client, buyer, order.json()["payment"]["id"], "ALERT00001")).status_code == 201
        while await drain_outbox({}):
            pass
        mailbox = tmp_path / "mailbox.jsonl"
        alerts = [m for m in (json.loads(line) for line in mailbox.read_text(encoding="utf-8").splitlines()) if m["to"] == "finance@example.com"]
        assert len(alerts) == 1
        # The test offer's currency comes from the shared helper; the amount and ID are what matter.
        assert alerts[0]["subject"].startswith("New payment to check: ")
        assert alerts[0]["subject"].endswith(" 114.00, TrxID ALERT00001")
        assert "For: Song" in alerts[0]["body"] and "a***@example.com" in alerts[0]["body"]
        assert "alert-buyer@" not in alerts[0]["body"]
        # Draining again sends nothing more.
        while await drain_outbox({}):
            pass
        again = [line for line in mailbox.read_text(encoding="utf-8").splitlines() if '"finance@example.com"' in line]
        assert len(again) == 1
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
