"""Pre-sales (owner, 2026-10-25, D-PRESALE-01): buyers who paid before launch get the song when
their email becomes a verified account, and each claim counts as a normal sale from then on."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from tests.auth_helpers import bearer, register_and_login, register_user
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _released


async def _mark_verified(email: str) -> None:
    """Accounts made by the test helpers are activated by staff; a pre-sale needs a proven email."""
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.identity.domain.models import User

    async with get_session_factory()() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one()
        user.email_verified_at = datetime.now(timezone.utc)
        await session.commit()


async def _verify_by_link(client: AsyncClient, user_id: str) -> None:
    """The real sign-up path: a verification challenge, then the link is opened."""
    from cornerroom.infra.db import get_session_factory
    from cornerroom.infra.settings import get_settings
    from cornerroom.modules.identity.application.services import IdentityService

    async with get_session_factory()() as session:
        raw = await IdentityService(session, get_settings()).issue_challenge(
            user_id=UUID(user_id), purpose="EMAIL_VERIFICATION", ttl_seconds=3600, request_id="test"
        )
        await session.commit()
    done = await client.post("/api/v1/auth/verification/complete", json={"token": raw})
    assert done.status_code == 204, done.text


async def _orders_of(email: str) -> int:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.commerce.domain.models import Order
    from cornerroom.modules.identity.domain.models import User

    async with get_session_factory()() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one()
        return (await session.execute(select(func.count()).select_from(Order).where(Order.user_id == user.id))).scalar_one()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_presale_buyers_get_the_song_on_verification_and_it_counts_as_a_sale(client: AsyncClient) -> None:
    from cornerroom.worker import drain_outbox

    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track, owner, artist_id = await _released(client, admin, label, "pre-artist@example.com", "Pre Act")
    finance = await _staff_with(client, admin, "pre-fin@example.com", "finance_manager", label)
    catalog = await _staff_with(client, admin, "pre-cat@example.com", "content_manager", label)
    queue = (await client.get("/api/v1/offer-proposals", headers=bearer(finance))).json()
    pid = next(p["id"] for p in queue if p["release_id"] == release_id)
    assert (await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(finance), json={"decision": "accept"})).status_code == 200
    product_id = next(o["product_id"] for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)

    # One buyer already has a verified account; the other signs up later.
    early = await register_and_login(client, "early-buyer@example.com")
    await _mark_verified("early-buyer@example.com")

    rows = [
        {"email": "Early-Buyer@Example.com ", "buyer_name": "Early  Buyer", "amount_minor": 25000, "paid_on": "2026-09-01"},
        {"email": "late-buyer@example.com", "buyer_name": "Late Buyer", "amount_minor": 40000},
        {"email": "late-buyer@example.com", "amount_minor": 40000},  # duplicate in the same file
    ]
    # Only finance staff of the product's label may record pre-sales (others: 404, Q-SEC-03).
    denied = await client.post("/api/v1/staff/presales", headers=bearer(catalog), json={"product_id": product_id, "rows": rows})
    assert denied.status_code == 404, denied.text
    up = await client.post("/api/v1/staff/presales", headers=bearer(finance), json={"product_id": product_id, "rows": rows})
    assert up.status_code == 201, up.text
    assert up.json() == {"added": 2, "skipped": ["late-buyer@example.com"], "claimed_now": 1}

    # Uploading the same list again changes nothing.
    again = await client.post("/api/v1/staff/presales", headers=bearer(finance), json={"product_id": product_id, "rows": rows[:2]})
    assert again.json()["added"] == 0 and sorted(again.json()["skipped"]) == ["early-buyer@example.com", "late-buyer@example.com"]

    listing = await client.get("/api/v1/staff/presales", headers=bearer(finance), params={"product_id": product_id})
    assert listing.status_code == 200, listing.text
    by_email = {r["email"]: r for r in listing.json()["items"]}
    assert by_email["early-buyer@example.com"]["status"] == "CLAIMED" and by_email["early-buyer@example.com"]["order_id"]
    assert by_email["early-buyer@example.com"]["buyer_name"] == "Early Buyer"
    assert by_email["late-buyer@example.com"]["status"] == "WAITING"
    assert listing.json()["totals"]["BDT"] == {"buyers": 2, "claimed": 1, "amount_minor": 65000, "claimed_amount_minor": 25000}
    assert (await client.get("/api/v1/staff/presales", headers=bearer(catalog), params={"product_id": product_id})).status_code == 404

    # The early buyer owns the release through a normal paid order.
    ents = (await client.get("/api/v1/me/entitlements", headers=bearer(early["access_token"]))).json()["items"]
    assert any(e["scope"] == "RELEASE" and e["ref_id"] == release_id and e["status"] == "ACTIVE" for e in ents)

    # The late buyer signs up and verifies the normal way; the outbox claims the pre-sale.
    late = await register_user(client, "late-buyer@example.com")
    await _verify_by_link(client, late["id"])
    while await drain_outbox({}):
        pass
    listing = (await client.get("/api/v1/staff/presales", headers=bearer(finance), params={"product_id": product_id})).json()
    assert {r["email"]: r["status"] for r in listing["items"]} == {"early-buyer@example.com": "CLAIMED", "late-buyer@example.com": "CLAIMED"}
    assert listing["totals"]["BDT"]["claimed_amount_minor"] == 65000

    # Each claim is a sale on the artist's Sales page, at what the buyer actually paid.
    sales = (await client.get(f"/api/v1/studio/profiles/artist/{artist_id}/sales", headers=bearer(owner["access_token"]))).json()
    assert sales["totals"][0]["sold_count"] == 2 and sales["totals"][0]["gross_amount_minor"] == 65000

    # Claiming again never makes a second order.
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.commerce.application.presales import PresaleService

    async with get_session_factory()() as session:
        assert await PresaleService(session).claim_for_user(UUID(early["user"]["id"])) == 0
        await session.commit()
    assert await _orders_of("early-buyer@example.com") == 1
    assert await _orders_of("late-buyer@example.com") == 1


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_waiting_presales_can_be_removed_and_unverified_accounts_do_not_claim(client: AsyncClient) -> None:
    from cornerroom.worker import drain_outbox

    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track, _owner, _artist = await _released(client, admin, label, "pre2-artist@example.com", "Pre Two")
    finance = await _staff_with(client, admin, "pre2-fin@example.com", "finance_manager", label)
    queue = (await client.get("/api/v1/offer-proposals", headers=bearer(finance))).json()
    pid = next(p["id"] for p in queue if p["release_id"] == release_id)
    await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(finance), json={"decision": "accept"})
    product_id = next(o["product_id"] for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)

    await client.post(
        "/api/v1/staff/presales",
        headers=bearer(finance),
        json={"product_id": product_id, "rows": [{"email": "unproven@example.com", "amount_minor": 1000}, {"email": "typo@example.com", "amount_minor": 1000}]},
    )
    # An account that never proved its email does not take a pre-sale.
    await register_user(client, "unproven@example.com")
    while await drain_outbox({}):
        pass
    rows = {r["email"]: r for r in (await client.get("/api/v1/staff/presales", headers=bearer(finance), params={"product_id": product_id})).json()["items"]}
    assert rows["unproven@example.com"]["status"] == "WAITING"

    cancelled = await client.post(f"/api/v1/staff/presales/{rows['typo@example.com']['id']}/cancel", headers=bearer(finance))
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
    assert (await client.post(f"/api/v1/staff/presales/{rows['typo@example.com']['id']}/cancel", headers=bearer(finance))).status_code == 409
    # A cancelled row frees the email for a corrected upload.
    redo = await client.post(
        "/api/v1/staff/presales", headers=bearer(finance), json={"product_id": product_id, "rows": [{"email": "typo@example.com", "amount_minor": 1500}]}
    )
    assert redo.json()["added"] == 1
    # Bad input is refused before anything is stored.
    bad = await client.post("/api/v1/staff/presales", headers=bearer(finance), json={"product_id": product_id, "rows": [{"email": "not-an-email", "amount_minor": 0}]})
    assert bad.status_code == 422
    negative = await client.post("/api/v1/staff/presales", headers=bearer(finance), json={"product_id": product_id, "rows": [{"email": "neg@example.com", "amount_minor": -100}]})
    assert negative.status_code == 422


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_a_gift_presale_gives_the_song_and_counts_as_a_sale_with_no_money(client: AsyncClient) -> None:
    """Owner, 2026-10-25: ৳0 gifts on the list get the song and count as a sale, but no payment is
    made, so nothing reaches finance."""
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.commerce.domain.models import Order
    from cornerroom.modules.finance.domain.models_payments import Payment

    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track, owner, artist_id = await _released(client, admin, label, "gift-artist@example.com", "Gift Act")
    finance = await _staff_with(client, admin, "gift-fin@example.com", "finance_manager", label)
    queue = (await client.get("/api/v1/offer-proposals", headers=bearer(finance))).json()
    pid = next(p["id"] for p in queue if p["release_id"] == release_id)
    await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(finance), json={"decision": "accept"})
    product_id = next(o["product_id"] for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)

    friend = await register_and_login(client, "gift-friend@example.com")
    await _mark_verified("gift-friend@example.com")
    up = await client.post(
        "/api/v1/staff/presales",
        headers=bearer(finance),
        json={"product_id": product_id, "rows": [{"email": "gift-friend@example.com", "buyer_name": "Friend", "amount_minor": 0}]},
    )
    assert up.status_code == 201, up.text
    assert up.json()["claimed_now"] == 1

    ents = (await client.get("/api/v1/me/entitlements", headers=bearer(friend["access_token"]))).json()["items"]
    assert any(e["scope"] == "RELEASE" and e["ref_id"] == release_id and e["status"] == "ACTIVE" for e in ents)
    sales = (await client.get(f"/api/v1/studio/profiles/artist/{artist_id}/sales", headers=bearer(owner["access_token"]))).json()
    assert sales["totals"][0]["sold_count"] == 1 and sales["totals"][0]["gross_amount_minor"] == 0

    async with get_session_factory()() as session:
        order = (await session.execute(select(Order).where(Order.user_id == UUID(friend["user"]["id"])))).scalar_one()
        assert order.status == "FULFILLED" and order.total_amount_minor == 0
        payments = (await session.execute(select(func.count()).select_from(Payment).where(Payment.order_id == order.id))).scalar_one()
        assert payments == 0
    # The OrderPaid event is delivered like any other (receipt notification, analytics).
    while await drain_outbox_all():
        pass


async def drain_outbox_all() -> int:
    from cornerroom.worker import drain_outbox

    return await drain_outbox({})
