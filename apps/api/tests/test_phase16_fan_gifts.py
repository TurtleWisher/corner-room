"""Fan gifts and gift credit (owner, 2026-11-20, D-GIFT-FAN-01).

A fan buys released music for people they know by email and pays first; the sale counts then.
After payment (and staff's check of the note) each person is emailed: an account that doesn't own
it owns it at once, a new address gets it on verification, and someone who owned it already keeps
the amount as credit for that act's music, passes it on or declines (the giver gets the credit). A
gift nobody claims in 7 days goes back to the giver as that credit. Credit pays whole orders of the
same act's music, with no new money."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from cornerroom.modules.commerce.application.fan_gifts import gift_email, mask_email, returned_email
from cornerroom.modules.commerce.domain.fan_gifts import (
    clean_note,
    clean_people,
    credit_back_reason,
    expires_from,
    giver_state,
    is_expired,
    may_choose,
)
from tests.auth_helpers import bearer, register_and_login, register_user
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _buy, _released
from tests.test_phase16_presales import _mark_verified, _verify_by_link

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)


# --- pure ------------------------------------------------------------------------------------------


def test_people_are_checked_and_never_include_the_giver() -> None:
    rows = clean_people(
        [{"email": " Rumi@Example.com ", "name": "  Rumi   Das "}, "nila@example.com"], giver_email="me@example.com", max_people=10
    )
    assert rows == [{"email": "rumi@example.com", "name": "Rumi Das"}, {"email": "nila@example.com", "name": None}]
    for raw, code in (
        ([], "NO_PEOPLE"),
        (["not-an-email"], "BAD_EMAIL"),
        (["ME@example.com"], "OWN_EMAIL"),
        (["a@example.com", "A@example.com"], "SAME_EMAIL_TWICE"),
        ([f"p{i}@example.com" for i in range(11)], "TOO_MANY_PEOPLE"),
    ):
        with pytest.raises(ValueError, match=code):
            clean_people(raw, giver_email="me@example.com", max_people=10)
    assert len(clean_people([f"p{i}@example.com" for i in range(30)], giver_email=None, max_people=0)) == 30


def test_note_is_optional_and_short() -> None:
    assert clean_note("  ") is None
    assert clean_note(" Happy birthday \r\n") == "Happy birthday"
    with pytest.raises(ValueError, match="NOTE_TOO_LONG"):
        clean_note("x" * 301)


def test_the_giver_never_learns_why() -> None:
    # Someone who owned it (CHOOSING) reads to the giver just like someone still to sign up.
    assert giver_state("CHOOSING") == giver_state("WAITING_ACCOUNT") == "DELIVERED"
    assert giver_state("KEPT_CREDIT") == giver_state("GIVEN") == "ACCEPTED"
    assert giver_state("DECLINED") == "DECLINED" and giver_state("EXPIRED") == "NOT_CLAIMED"
    assert credit_back_reason("DECLINED") == "GIFT_DECLINED" and credit_back_reason("EXPIRED") == "GIFT_NOT_CLAIMED"
    assert credit_back_reason("KEPT_CREDIT") is None


def test_seven_days_to_claim_and_choices_only_for_owners() -> None:
    until = expires_from(NOW, 7)
    assert until == NOW + timedelta(days=7) and expires_from(NOW, 0) is None
    assert not is_expired("WAITING_ACCOUNT", until, NOW + timedelta(days=6))
    assert is_expired("WAITING_ACCOUNT", until, NOW + timedelta(days=7))
    assert not is_expired("GIVEN", until, NOW + timedelta(days=30))
    assert may_choose("CHOOSING", "PASS_ON") and not may_choose("GIVEN", "KEEP_CREDIT") and not may_choose("CHOOSING", "REFUND")


def test_gift_emails_say_what_happens_next() -> None:
    subject, body = gift_email(
        giver="Samiul", passed_by=None, title="Chhaya Pore", act="MIZULS", note="For you", status="WAITING_ACCOUNT",
        link="https://x/gift/t", claim_days=7,
    )
    assert subject == "Samiul sent you Chhaya Pore by MIZULS"
    assert "For you" in body and "waits 7 days" in body and "https://x/gift/t" in body
    # The email to someone who owned it doesn't say so either (the giver may be reading over a shoulder).
    _s, owned = gift_email(giver=None, passed_by="Rumi", title="T", act="A", note=None, status="CHOOSING", link="L", claim_days=7)
    assert "Rumi passed on a gift" in owned and "already" not in owned
    _s, back = returned_email(title="T", act="A", status="EXPIRED", amount="BDT 30.00", link="L")
    assert "wasn't claimed in time" in back and "BDT 30.00" in back and "credit" in back
    assert mask_email("samiul@example.com") == "s•••@example.com"


# --- with the database -----------------------------------------------------------------------------


async def _tokens() -> dict[str, str]:
    """Each emailed person's gift link token, read from the outbox (the email itself is a stub)."""
    from cornerroom.infra.db import get_session_factory
    from cornerroom.infra.outbox import OutboxEvent
    from cornerroom.modules.commerce.domain.fan_gifts import FanGiftRecipient

    async with get_session_factory()() as session:
        rows = (
            await session.execute(
                select(OutboxEvent).where(OutboxEvent.event_type == "FanGiftSent").order_by(OutboxEvent.occurred_at, OutboxEvent.id)
            )
        ).scalars().all()
        out = {}
        for row in rows:
            # The newest link per person wins (a second gift to the same address).
            person = await session.get(FanGiftRecipient, UUID(str(row.aggregate_id or row.payload["aggregate_id"])))
            out[person.email] = row.payload["payload"]["token"]
        return out


async def _gift_order(client: AsyncClient, token: str, offer_id: str, people: list, note: str | None = None):
    return await client.post(
        "/api/v1/orders",
        headers={**bearer(token), "Idempotency-Key": f"g-{uuid4()}"},
        json={"offer_id": offer_id, "gift": {"people": people, "note": note}},
    )


async def _pay(client: AsyncClient, token: str, order: dict) -> dict:
    paid = await client.post(f"/api/v1/payments/{order['payment']['id']}/sandbox-confirm", headers=bearer(token))
    assert paid.status_code == 200, paid.text
    return paid.json()


async def _owns(user_id: str, release_id: str) -> bool:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.entitlements.application.service import EntitlementService

    async with get_session_factory()() as session:
        return await EntitlementService(session).find_active_release(UUID(user_id), UUID(release_id)) is not None


class _Later:
    def now(self) -> datetime:
        return datetime.now(timezone.utc) + timedelta(days=8)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_a_fan_gift_from_payment_to_credit(client: AsyncClient) -> None:
    from cornerroom.worker import drain_outbox

    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track, _owner, _artist = await _released(client, admin, label, "fg-owner@example.com", "Gift Act")
    ops = await _staff_with(client, admin, "fg-ops@example.com", "finance_manager", label)
    reviewer = await _staff_with(client, admin, "fg-reviewer@example.com", "content_manager", label)
    proposal = next(p for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json() if p["release_id"] == release_id)
    await client.post(f"/api/v1/offer-proposals/{proposal['id']}/decision", headers=bearer(ops), json={"decision": "accept"})
    offer = next(o for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)

    giver = await register_and_login(client, "fg-giver@example.com")
    gtoken = giver["access_token"]
    friend = await register_and_login(client, "fg-friend@example.com")
    await _mark_verified("fg-friend@example.com")
    fan = await register_and_login(client, "fg-fan@example.com")
    await _mark_verified("fg-fan@example.com")
    await _buy(client, fan["access_token"], offer["id"])  # already owns the release

    # The giver's own address and repeats are refused; nothing is looked up about the people.
    own = await _gift_order(client, gtoken, offer["id"], [{"email": "FG-Giver@example.com"}])
    assert own.status_code == 422 and own.json()["code"] == "OWN_EMAIL"
    many = await _gift_order(client, gtoken, offer["id"], [{"email": f"p{i}@example.com"} for i in range(11)])
    assert many.status_code == 422 and many.json()["code"] == "TOO_MANY_PEOPLE"

    placed = await _gift_order(
        client, gtoken, offer["id"],
        [{"email": "fg-friend@example.com", "name": "Friend"}, {"email": "fg-fan@example.com"}, {"email": "fg-new@example.com"}],
        note="Happy Eid!",
    )
    assert placed.status_code == 201, placed.text
    order = placed.json()
    # One line per person, the sale counted on the giver's order.
    assert order["is_gift"] is True and order["total_amount_minor"] == 3 * offer["amount_minor"] and len(order["items"]) == 3
    paid = await _pay(client, gtoken, order)
    assert paid["status"] == "FULFILLED"
    assert not await _owns(giver["user"]["id"], release_id)

    # The note waits for staff, so nobody is emailed yet.
    mine = (await client.get("/api/v1/me/fan-gifts", headers=bearer(gtoken))).json()
    assert mine[0]["status"] == "WAITING_NOTE" and {p["state"] for p in mine[0]["people"]} == {"NOT_SENT_YET"}
    # A fan has no staff workspace, so the notes list is refused (409 NO_WORKSPACE, like other staff queues).
    assert (await client.get("/api/v1/staff/fan-gift-notes", headers=bearer(gtoken))).status_code in (403, 404, 409)
    queue = (await client.get("/api/v1/staff/fan-gift-notes", headers=bearer(reviewer))).json()
    assert [q["note"] for q in queue] == ["Happy Eid!"] and queue[0]["people"] == 3
    reviewed = await client.post(f"/api/v1/staff/fan-gift-notes/{queue[0]['id']}/review", headers=bearer(reviewer), json={"approve": True})
    assert reviewed.json() == {"id": queue[0]["id"], "note_state": "APPROVED", "status": "DELIVERED"}

    # The friend owns it now; the fan (who owned it) and the new address read the same to the giver.
    assert await _owns(friend["user"]["id"], release_id)
    states = {p["email"]: p["state"] for p in (await client.get("/api/v1/me/fan-gifts", headers=bearer(gtoken))).json()[0]["people"]}
    assert states == {"fg-friend@example.com": "ACCEPTED", "fg-fan@example.com": "DELIVERED", "fg-new@example.com": "DELIVERED"}

    tokens = await _tokens()
    page = (await client.get(f"/api/v1/gifts/{tokens['fg-fan@example.com']}", headers=bearer(fan["access_token"]))).json()
    assert page["viewer"] == "RECIPIENT" and page["status"] == "CHOOSING" and page["note"] == "Happy Eid!"
    # Anyone else holding the link sees the gift, never its state.
    other = (await client.get(f"/api/v1/gifts/{tokens['fg-fan@example.com']}", headers=bearer(friend["access_token"]))).json()
    assert other["viewer"] == "SIGNED_IN" and other["status"] is None and other["amount"] is None
    assert (await client.get("/api/v1/gifts/not-a-token")).status_code == 404
    refused = await client.post(f"/api/v1/gifts/{tokens['fg-fan@example.com']}/choose", headers=bearer(friend["access_token"]), json={"choice": "KEEP_CREDIT"})
    assert refused.status_code == 404

    kept = (await client.post(f"/api/v1/gifts/{tokens['fg-fan@example.com']}/choose", headers=bearer(fan["access_token"]), json={"choice": "KEEP_CREDIT"})).json()
    assert kept["status"] == "KEPT_CREDIT" and kept["credit"]["amount_minor"] == offer["amount_minor"]
    credit = (await client.get("/api/v1/me/gift-credit", headers=bearer(fan["access_token"]))).json()
    assert credit[0]["act_name"] == "Gift Act" and credit[0]["balance"]["amount_minor"] == offer["amount_minor"]
    again = await client.post(f"/api/v1/gifts/{tokens['fg-fan@example.com']}/choose", headers=bearer(fan["access_token"]), json={"choice": "DECLINE"})
    assert again.status_code == 409

    # The new address signs up and verifies: it's theirs.
    newcomer = await register_user(client, "fg-new@example.com")
    await _verify_by_link(client, newcomer["id"])
    while await drain_outbox({}):
        pass
    assert await _owns(newcomer["id"], release_id)

    # A second gift with no note goes at once; the fan declines it, so the giver gets the credit.
    second = (await _gift_order(client, gtoken, offer["id"], [{"email": "fg-fan@example.com"}, {"email": "fg-never@example.com"}])).json()
    await _pay(client, gtoken, second)
    tokens = await _tokens()
    declined = await client.post(f"/api/v1/gifts/{tokens['fg-fan@example.com']}/choose", headers=bearer(fan["access_token"]), json={"choice": "DECLINE"})
    assert declined.json()["status"] == "DECLINED"

    # Nobody claims the other one in 7 days: it goes back to the giver as credit too.
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.commerce.application.fan_gifts import FanGiftService

    async with get_session_factory()() as session:
        assert await FanGiftService(session, clock=_Later()).expire_due() == 1
        await session.commit()
    gift_states = {p["email"]: p["state"] for p in (await client.get("/api/v1/me/fan-gifts", headers=bearer(gtoken))).json()[0]["people"]}
    assert gift_states == {"fg-fan@example.com": "DECLINED", "fg-never@example.com": "NOT_CLAIMED"}
    balance = (await client.get("/api/v1/me/gift-credit", headers=bearer(gtoken))).json()[0]["balance"]["amount_minor"]
    assert balance == 2 * offer["amount_minor"]

    # The giver spends credit on the act's music: a ৳0 order, owned at once, the rest kept.
    usable = (await client.get(f"/api/v1/me/gift-credit/offers/{offer['id']}", headers=bearer(gtoken))).json()
    assert usable["usable"] is True and usable["act_name"] == "Gift Act"
    spent = await client.post(
        "/api/v1/orders", headers={**bearer(gtoken), "Idempotency-Key": f"c-{uuid4()}"},
        json={"offer_id": offer["id"], "use_credit": True, "delivery_address_confirmed": True},
    )
    assert spent.status_code == 201, spent.text
    body = spent.json()
    assert body["status"] == "FULFILLED" and body["total_amount_minor"] == 0
    assert body["paid_with_credit_minor"] == offer["amount_minor"] and body["payment"] is None
    assert await _owns(giver["user"]["id"], release_id)
    left = (await client.get("/api/v1/me/gift-credit", headers=bearer(gtoken))).json()[0]["balance"]["amount_minor"]
    assert left == offer["amount_minor"]
    # Credit can't pay for a gift, and someone without credit can't use it.
    mixed = await client.post(
        "/api/v1/orders", headers={**bearer(gtoken), "Idempotency-Key": f"m-{uuid4()}"},
        json={"offer_id": offer["id"], "use_credit": True, "gift": {"people": [{"email": "x@example.com"}]}},
    )
    assert mixed.status_code == 422
    none = await client.post(
        "/api/v1/orders", headers={**bearer(friend["access_token"]), "Idempotency-Key": f"n-{uuid4()}"},
        json={"offer_id": offer["id"], "use_credit": True, "delivery_address_confirmed": True},
    )
    assert none.status_code == 409
