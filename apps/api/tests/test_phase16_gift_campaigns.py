"""Gift campaigns (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02): an artist sets up a gift for
buyers of their music, staff approve it, it can pause and restart (purchases while paused don't
count), each gift is tracked as yet to send, in process or sent, and dispatching tells the buyer by
email and in-app that it is on its way."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.modules.commerce.application.gifts import build_gift_email, in_periods
from cornerroom.modules.notifications.domain.models import Notification
from cornerroom.worker import drain_outbox
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _buy, _released

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


def test_purchase_counts_only_while_live() -> None:
    periods = [(NOW - timedelta(days=10), NOW - timedelta(days=5)), (NOW - timedelta(days=2), None)]
    assert in_periods(NOW - timedelta(days=7), periods, NOW)
    assert not in_periods(NOW - timedelta(days=3), periods, NOW)  # paused then
    assert in_periods(NOW - timedelta(hours=1), periods, NOW)
    assert not in_periods(NOW - timedelta(days=20), periods, NOW)


def test_gift_email_for_buyers_without_an_account() -> None:
    subject, body = build_gift_email(artist="MIZULS", gift="a signed poster", music="Chaya Pore", web_base_url="https://www.cornerroom.live/")
    assert subject == "A gift is on its way"
    assert "MIZULS" in body and "signed poster" in body and "Chaya Pore" in body and "next few days" in body
    assert "https://www.cornerroom.live" in body


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_gift_campaign_review_pause_tracking_and_dispatch(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track_id, owner, artist_id = await _released(client, admin, label, "gift-owner@example.com", "Gift Band")
    token = owner["access_token"]
    ops = await _staff_with(client, admin, "gift-ops@example.com", "finance_manager", label)
    reviewer = await _staff_with(client, admin, "gift-reviewer@example.com", "content_manager", label)
    proposal = next(p for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json() if p["release_id"] == release_id)
    await client.post(f"/api/v1/offer-proposals/{proposal['id']}/decision", headers=bearer(ops), json={"decision": "accept"})
    offer = next(o for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)

    early = await register_and_login(client, "gift-early@example.com")
    await _buy(client, early["access_token"], offer["id"])

    # Set up: a draft, not public; only this artist's music; sent for review; the artist can't approve it.
    bad = await client.post(
        f"/api/v1/studio/profiles/artist/{artist_id}/gift-campaigns", headers=bearer(token),
        json={"title": "Poster", "gift_items": "A signed poster", "works": []},
    )
    assert bad.status_code == 422
    created = await client.post(
        f"/api/v1/studio/profiles/artist/{artist_id}/gift-campaigns", headers=bearer(token),
        json={"title": "Launch gift", "gift_items": "A signed poster", "description": "Thank you for listening.",
              "sender": "ARTIST", "works": [{"type": "RELEASE", "id": release_id}]},
    )
    assert created.status_code == 201, created.text
    campaign = created.json()
    cid = campaign["id"]
    assert campaign["status"] == "DRAFT" and campaign["works"][0]["title"] == "Review Me"
    assert (await client.get("/api/v1/gift-campaigns", params={"release_id": release_id})).json() == []
    assert (await client.post(f"/api/v1/studio/gift-campaigns/{cid}/submit", headers=bearer(token))).json()["status"] == "IN_REVIEW"
    queue = (await client.get("/api/v1/catalog-intake/gift-campaigns", headers=bearer(reviewer))).json()
    assert [c["id"] for c in queue] == [cid]
    own = await client.post(f"/api/v1/catalog-intake/gift-campaigns/{cid}/review", headers=bearer(token), json={"action": "approve"})
    assert own.status_code == 404
    live = await client.post(f"/api/v1/catalog-intake/gift-campaigns/{cid}/review", headers=bearer(reviewer), json={"action": "approve"})
    assert live.status_code == 200 and live.json()["status"] == "ACTIVE"
    public = (await client.get("/api/v1/gift-campaigns", params={"release_id": release_id})).json()
    assert [g["title"] for g in public] == ["Launch gift"] and public[0]["artist"] == "Gift Band"

    # A buyer from before the campaign doesn't count; one while it is live does.
    fan = await register_and_login(client, "gift-fan@example.com")
    await _buy(client, fan["access_token"], offer["id"])
    detail = (await client.get(f"/api/v1/studio/gift-campaigns/{cid}", headers=bearer(token))).json()
    assert detail["counts"] == {"YET_TO_SEND": 1, "IN_PROCESS": 0, "SENT": 0, "TOTAL": 1}
    row = detail["recipients"][0]
    # The artist sends these gifts, so sees where to post them, but not the email.
    assert detail["shows_contact"] is True and row["address"] and row["phone"] and "email" not in {k for k, v in row.items() if v}

    # Paused: a purchase now doesn't count. Restarted at once.
    assert (await client.post(f"/api/v1/studio/gift-campaigns/{cid}/pause", headers=bearer(token))).json()["status"] == "PAUSED"
    assert (await client.get("/api/v1/gift-campaigns", params={"release_id": release_id})).json() == []
    paused_buyer = await register_and_login(client, "gift-paused@example.com")
    await _buy(client, paused_buyer["access_token"], offer["id"])
    assert (await client.post(f"/api/v1/studio/gift-campaigns/{cid}/resume", headers=bearer(token))).json()["status"] == "ACTIVE"
    assert (await client.get(f"/api/v1/studio/gift-campaigns/{cid}", headers=bearer(token))).json()["counts"]["TOTAL"] == 1

    # A change to a live campaign waits for staff: counting from earlier brings in the early buyer.
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    changed = await client.patch(f"/api/v1/studio/gift-campaigns/{cid}", headers=bearer(token), json={"counts_from": since})
    assert changed.status_code == 200 and changed.json()["pending"] is not None
    assert changed.json()["counts"]["TOTAL"] == 1
    await client.post(f"/api/v1/catalog-intake/gift-campaigns/{cid}/review", headers=bearer(reviewer), json={"action": "approve"})
    detail = (await client.get(f"/api/v1/studio/gift-campaigns/{cid}", headers=bearer(token))).json()
    assert detail["counts"]["TOTAL"] == 2  # the paused-time buyer still doesn't count

    # Dispatch one: it is in process and the buyer is told; then sent.
    fan_row = next(r for r in (await client.get(f"/api/v1/studio/gift-campaigns/{cid}", headers=bearer(reviewer))).json()["recipients"] if r["email"] == "gift-fan@example.com")
    sent = await client.post(f"/api/v1/studio/gift-campaigns/{cid}/dispatch", headers=bearer(token), json={"recipient_ids": [fan_row["id"]]})
    assert sent.status_code == 200, sent.text
    assert sent.json()["counts"] == {"YET_TO_SEND": 1, "IN_PROCESS": 1, "SENT": 0, "TOTAL": 2}
    while await drain_outbox({}):
        pass
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        note = (await session.execute(select(Notification).where(Notification.type == "gift.dispatched"))).scalars().one()
    assert str(note.user_id) == fan["user"]["id"]
    assert "Gift Band" in note.body and "signed poster" in note.body and "next few days" in note.body
    done = await client.post(f"/api/v1/studio/gift-campaigns/{cid}/sent", headers=bearer(token), json={"recipient_ids": [fan_row["id"]]})
    assert done.json()["counts"] == {"YET_TO_SEND": 1, "IN_PROCESS": 0, "SENT": 1, "TOTAL": 2}

    # A campaign Corner Room sends: the artist sees counts only and can't dispatch.
    team = await client.post(
        f"/api/v1/studio/profiles/artist/{artist_id}/gift-campaigns", headers=bearer(token),
        json={"title": "Team gift", "gift_items": "A badge", "sender": "CORNER_ROOM", "works": [{"type": "RELEASE", "id": release_id}],
              "counts_from": since},
    )
    tid = team.json()["id"]
    await client.post(f"/api/v1/studio/gift-campaigns/{tid}/submit", headers=bearer(token))
    await client.post(f"/api/v1/catalog-intake/gift-campaigns/{tid}/review", headers=bearer(reviewer), json={"action": "approve"})
    seen = (await client.get(f"/api/v1/studio/gift-campaigns/{tid}", headers=bearer(token))).json()
    assert seen["shows_contact"] is False and seen["can_dispatch"] is False
    assert all(r.get("address") is None and r.get("name") is None for r in seen["recipients"])
    blocked = await client.post(f"/api/v1/studio/gift-campaigns/{tid}/dispatch", headers=bearer(token), json={"recipient_ids": [seen["recipients"][0]["id"]]})
    assert blocked.status_code == 403
    staff_view = (await client.get(f"/api/v1/studio/gift-campaigns/{tid}", headers=bearer(reviewer))).json()
    assert staff_view["can_dispatch"] is True and staff_view["recipients"][0]["email"]
    outsider = await register_and_login(client, "gift-outsider@example.com")
    assert (await client.get(f"/api/v1/studio/gift-campaigns/{cid}", headers=bearer(outsider["access_token"]))).status_code == 404
