"""Pre-sales on Corner Room (owner, 2026-10-28, D-PRESALE-02): a scheduled release takes pre-orders
at its own pre-sale price; the music unlocks on release day; at the scheduled time it goes public
by itself and buyers are told; a new date tells them; a cancellation sends every pre-order to
finance for a full refund."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.modules.commerce.application.onsite_presale import presale_open, release_date_text
from cornerroom.modules.finance.domain.models_payments import Refund
from cornerroom.modules.music.domain.models import Release
from cornerroom.modules.notifications.domain.models import Notification
from cornerroom.worker import drain_outbox, release_scheduled
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _ready_single, _review
from tests.test_audio_phase7_release_commerce import _buy

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


def test_presale_window_and_date_words() -> None:
    class R:
        deleted_at = None

        def __init__(self, status: str, at: datetime | None) -> None:
            self.status, self.release_at = status, at

    assert presale_open(R("SCHEDULED", NOW + timedelta(days=1)), NOW)
    assert not presale_open(R("SCHEDULED", NOW - timedelta(minutes=1)), NOW)
    assert not presale_open(R("APPROVED", NOW + timedelta(days=1)), NOW)
    assert not presale_open(R("RELEASED", NOW + timedelta(days=1)), NOW)
    assert release_date_text(datetime(2026, 11, 5, 14, 0, tzinfo=timezone.utc)) == "05 Nov 2026, 08:00 PM (Dhaka time)"


async def _presale_release(client: AsyncClient, admin: str, label: str, tag: str) -> tuple[str, str, str, str, str]:
    """An approved single with an agreed pre-sale price of 2,000 (minor units)."""
    owner = await register_and_login(client, f"ps-owner-{tag}@example.com")
    artist_id = await _artist_for(owner["user"]["id"], label, name=f"Presale {tag}")
    reviewer = await _staff_with(client, admin, f"ps-reviewer-{tag}@example.com", "content_manager", label)
    ops = await _staff_with(client, admin, f"ps-ops-{tag}@example.com", "finance_manager", label)
    release_id, track_id = await _ready_single(client, owner["access_token"], artist_id)
    for action in ("start_review", "approve"):
        assert (await _review(client, reviewer, release_id, action)).status_code == 200
    proposed = await client.post(
        f"/api/v1/studio/releases/{release_id}/price-proposals", headers=bearer(owner["access_token"]),
        json={"subject_type": "RELEASE", "subject_id": release_id, "audience": "PRESALE", "amount_minor": 2000},
    )
    assert proposed.status_code in (200, 201), proposed.text
    pid = next(p["id"] for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json()
               if p["release_id"] == release_id and p["audience"] == "PRESALE")
    assert (await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(ops), json={"decision": "accept"})).status_code == 200
    return release_id, track_id, owner["access_token"], reviewer, ops


async def _schedule(client: AsyncClient, reviewer: str, release_id: str, at: datetime):  # type: ignore[no-untyped-def]
    return await _review(client, reviewer, release_id, "schedule", release_at=at.isoformat())


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_preorder_unlocks_on_release_day_and_buyers_are_told(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, track_id, _owner, reviewer, _ops = await _presale_release(client, admin, label, "a")
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)

    # Not scheduled yet: no pre-order page, and the pre-sale price isn't listed.
    assert (await client.get(f"/api/v1/presales/releases/{release_id}")).status_code == 404
    assert not [o for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id and o["audience"] == "PRESALE"]

    # Scheduled: pre-orders open at the pre-sale price.
    assert (await _schedule(client, reviewer, release_id, datetime.now(timezone.utc) + timedelta(days=1))).status_code == 200
    page = (await client.get(f"/api/v1/presales/releases/{release_id}")).json()
    assert page["offer"]["amount_minor"] == 2000 and page["tracks"][0]["title"] == "Song" and page["artist"] == "Presale a"
    offer_id = page["offer"]["id"]
    fan = await register_and_login(client, "ps-fan-a@example.com")
    receipt = await _buy(client, fan["access_token"], offer_id)
    assert receipt["is_presale"] is True
    again = await client.post(
        "/api/v1/orders", headers={**bearer(fan["access_token"]), "Idempotency-Key": "ps-again"},
        json={"offer_id": offer_id, "delivery_address_confirmed": True},
    )
    assert again.status_code == 409
    # Locked until release day.
    early = await client.post("/api/v1/playback/sessions", headers=bearer(fan["access_token"]), json={"track_id": track_id})
    assert early.status_code in (403, 404, 409)

    # A new date: buyers are told.
    assert (await _schedule(client, reviewer, release_id, datetime.now(timezone.utc) + timedelta(days=2))).status_code == 200
    while await drain_outbox({}):
        pass
    async with factory() as session:
        moved = (await session.execute(select(Notification).where(Notification.type == "presale.date_changed"))).scalars().all()
    assert [str(n.user_id) for n in moved] == [fan["user"]["id"]]
    assert "Review Me" in moved[0].body and "Dhaka time" in moved[0].body

    # The date comes: the scheduler releases it, buyers are told, the pre-sale price ends.
    async with factory() as session:
        await session.execute(update(Release).where(Release.id == release_id).values(release_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        await session.commit()
    assert await release_scheduled({}) == 1
    while await drain_outbox({}):
        pass
    assert (await client.get(f"/api/v1/releases/{release_id}")).json()["status"] == "RELEASED"
    async with factory() as session:
        out = (await session.execute(select(Notification).where(Notification.type == "presale.released"))).scalars().all()
    assert [str(n.user_id) for n in out] == [fan["user"]["id"]] and "is out now" in out[0].body
    assert (await client.get(f"/api/v1/presales/releases/{release_id}")).status_code == 404
    late = await client.post(
        "/api/v1/orders", headers={**bearer(fan["access_token"]), "Idempotency-Key": "ps-late"},
        json={"offer_id": offer_id, "delivery_address_confirmed": True},
    )
    assert late.status_code in (404, 409)
    now_playable = await client.post("/api/v1/playback/sessions", headers=bearer(fan["access_token"]), json={"track_id": track_id})
    assert now_playable.status_code == 201, now_playable.text
    history = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(reviewer))).json()["history"]
    assert history[0]["action"] == "release" and "scheduled date" in history[0]["note"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_cancelled_presale_refunds_every_preorder(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track_id, owner, reviewer, ops = await _presale_release(client, admin, label, "b")
    assert (await _schedule(client, reviewer, release_id, datetime.now(timezone.utc) + timedelta(days=3))).status_code == 200
    offer_id = (await client.get(f"/api/v1/presales/releases/{release_id}")).json()["offer"]["id"]
    fan = await register_and_login(client, "ps-fan-b@example.com")
    await _buy(client, fan["access_token"], offer_id)

    # The artist and finance-only staff can't cancel; staff with catalog and finance rights can.
    assert (await client.post(f"/api/v1/catalog-intake/releases/{release_id}/presale/cancel", headers=bearer(owner), json={})).status_code == 404
    assert (await client.post(f"/api/v1/catalog-intake/releases/{release_id}/presale/cancel", headers=bearer(ops), json={})).status_code == 404
    manager = (await client.post(f"/api/v1/organizations/{label}/switch", headers=bearer(admin))).json()["access_token"]
    cancelled = await client.post(
        f"/api/v1/catalog-intake/releases/{release_id}/presale/cancel", headers=bearer(manager), json={"note": "Mastering issue"}
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json() == {"status": "APPROVED", "refunds_requested": 1, "buyers_told": 1}
    assert (await client.get(f"/api/v1/presales/releases/{release_id}")).status_code == 404

    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        refunds = (await session.execute(select(Refund).where(Refund.reason_code == "PRESALE_CANCELLED"))).scalars().all()
    assert len(refunds) == 1 and refunds[0].amount_minor == 2000 and refunds[0].status == "REQUESTED"
    while await drain_outbox({}):
        pass
    async with factory() as session:
        told = (await session.execute(select(Notification).where(Notification.type == "presale.cancelled"))).scalars().all()
    assert [str(n.user_id) for n in told] == [fan["user"]["id"]] and "full refund" in told[0].body
