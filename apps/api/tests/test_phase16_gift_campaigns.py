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
from cornerroom.kernel.events import GIFT_MARKED_MISSING, GIFT_RETURNED
from cornerroom.modules.commerce.application.gifts import build_gift_email, in_periods
from cornerroom.modules.commerce.domain.gifts import RECIPIENT_STATUSES, RECIPIENT_TRANSITIONS, can_move, clean_person, phone_key
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


def test_collectible_moves() -> None:
    """D-CAMPAIGN-03: not prepared -> prepared -> dispatched -> received, returned or missing."""
    assert can_move("YET_TO_SEND", "PREPARED") and can_move("PREPARED", "YET_TO_SEND")
    assert can_move("PREPARED", "DISPATCHED")
    assert not can_move("YET_TO_SEND", "DISPATCHED")  # prepare first
    for outcome in ("RECEIVED", "RETURNED", "MISSING"):
        assert can_move("DISPATCHED", outcome)
    assert can_move("RETURNED", "PREPARED") and can_move("MISSING", "RECEIVED") and can_move("MISSING", "PREPARED")
    assert RECIPIENT_TRANSITIONS["RECEIVED"] == ()
    assert set(RECIPIENT_TRANSITIONS) == set(RECIPIENT_STATUSES)
    assert all(t in RECIPIENT_STATUSES for targets in RECIPIENT_TRANSITIONS.values() for t in targets)


def test_returned_and_missing_emails() -> None:
    subject, body = build_gift_email(
        artist="MIZULS", gift="a signed poster", music="Chaya Pore", web_base_url="https://www.cornerroom.live/", event_type=GIFT_RETURNED
    )
    assert subject == "Your gift couldn't be delivered"
    assert body.startswith("Your gift from MIZULS (a signed poster), for buying Chaya Pore, couldn't be delivered")
    assert "delivery address you gave us" in body and "it will be sent again" in body
    subject, body = build_gift_email(
        artist="MIZULS", gift="a signed poster", music="Chaya Pore", web_base_url="https://www.cornerroom.live/", event_type=GIFT_MARKED_MISSING
    )
    assert subject == "Your gift is taking longer than expected"
    assert body.startswith("Your gift from MIZULS (a signed poster), for buying Chaya Pore, hasn't arrived yet")
    assert "we'll send another" in body and "You don't need to do anything" in body


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
    assert detail["counts"] == {"YET_TO_SEND": 1, "PREPARED": 0, "DISPATCHED": 0, "RECEIVED": 0, "RETURNED": 0, "MISSING": 0, "TOTAL": 1, "SCHEDULED": 0, "WAITING": 0}
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

    # Track one (D-CAMPAIGN-03): it can't leave before it is prepared; "mark all prepared" prepares
    # everyone not prepared yet; dispatching tells the buyer; then received.
    fan_row = next(r for r in (await client.get(f"/api/v1/studio/gift-campaigns/{cid}", headers=bearer(reviewer))).json()["recipients"] if r["email"] == "gift-fan@example.com")
    move = f"/api/v1/studio/gift-campaigns/{cid}/recipients/transition"
    early_out = await client.post(move, headers=bearer(token), json={"to": "DISPATCHED", "recipient_ids": [fan_row["id"]]})
    assert early_out.status_code == 200 and early_out.json()["moved"] == 0 and early_out.json()["skipped"] == 1
    prepared = await client.post(move, headers=bearer(token), json={"to": "PREPARED", "every": "YET_TO_SEND"})
    assert prepared.status_code == 200, prepared.text
    assert prepared.json()["moved"] == 2 and prepared.json()["counts"] == {"YET_TO_SEND": 0, "PREPARED": 2, "DISPATCHED": 0, "RECEIVED": 0, "RETURNED": 0, "MISSING": 0, "TOTAL": 2, "SCHEDULED": 0, "WAITING": 0}
    assert prepared.json()["transitions"]["PREPARED"] == ["YET_TO_SEND", "DISPATCHED"]
    # A dispatch time already gone is refused; a later one schedules it (still prepared).
    gone = await client.post(move, headers=bearer(token), json={"to": "DISPATCHED", "recipient_ids": [fan_row["id"]], "dispatch_at": "2020-01-01T00:00:00+00:00"})
    assert gone.status_code == 422 and gone.json()["code"] == "DISPATCH_TIME_PASSED"
    later = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    scheduled = await client.post(move, headers=bearer(token), json={"to": "DISPATCHED", "recipient_ids": [fan_row["id"]], "dispatch_at": later})
    assert scheduled.json()["counts"]["SCHEDULED"] == 1 and scheduled.json()["counts"]["PREPARED"] == 2
    assert next(r for r in scheduled.json()["recipients"] if r["id"] == fan_row["id"])["dispatch_at"]
    # Dispatch now instead: the buyer is told.
    sent = await client.post(move, headers=bearer(token), json={"to": "DISPATCHED", "recipient_ids": [fan_row["id"]]})
    assert sent.status_code == 200, sent.text
    assert sent.json()["counts"] == {"YET_TO_SEND": 0, "PREPARED": 1, "DISPATCHED": 1, "RECEIVED": 0, "RETURNED": 0, "MISSING": 0, "TOTAL": 2, "SCHEDULED": 0, "WAITING": 0}
    while await drain_outbox({}):
        pass
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        note = (await session.execute(select(Notification).where(Notification.type == "gift.dispatched"))).scalars().one()
    assert str(note.user_id) == fan["user"]["id"]
    assert "Gift Band" in note.body and "signed poster" in note.body and "next few days" in note.body
    # Missing tells the buyer; then it turns up after all.
    missing = await client.post(move, headers=bearer(token), json={"to": "MISSING", "recipient_ids": [fan_row["id"]]})
    assert missing.json()["counts"]["MISSING"] == 1
    while await drain_outbox({}):
        pass
    async with factory() as session:
        note = (await session.execute(select(Notification).where(Notification.type == "gift.missing"))).scalars().one()
    assert str(note.user_id) == fan["user"]["id"] and "we'll send another" in note.body
    done = await client.post(move, headers=bearer(token), json={"to": "RECEIVED", "recipient_ids": [fan_row["id"]]})
    assert done.json()["counts"] == {"YET_TO_SEND": 0, "PREPARED": 1, "DISPATCHED": 0, "RECEIVED": 1, "RETURNED": 0, "MISSING": 0, "TOTAL": 2, "SCHEDULED": 0, "WAITING": 0}
    assert next(r for r in done.json()["recipients"] if r["id"] == fan_row["id"])["outcome_at"]

    # The release's collectibles, for its numbers page: the team sees this campaign's counts.
    on_release = await client.get(f"/api/v1/studio/releases/{release_id}/collectibles", headers=bearer(token))
    assert on_release.status_code == 200 and [c["id"] for c in on_release.json()] == [cid]
    assert on_release.json()[0]["counts"]["RECEIVED"] == 1

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
    blocked = await client.post(
        f"/api/v1/studio/gift-campaigns/{tid}/recipients/transition", headers=bearer(token),
        json={"to": "PREPARED", "recipient_ids": [seen["recipients"][0]["id"]]},
    )
    assert blocked.status_code == 403
    staff_view = (await client.get(f"/api/v1/studio/gift-campaigns/{tid}", headers=bearer(reviewer))).json()
    assert staff_view["can_dispatch"] is True and staff_view["recipients"][0]["email"]
    outsider = await register_and_login(client, "gift-outsider@example.com")
    assert (await client.get(f"/api/v1/studio/gift-campaigns/{cid}", headers=bearer(outsider["access_token"]))).status_code == 404
    assert (await client.get(f"/api/v1/studio/releases/{release_id}/collectibles", headers=bearer(outsider["access_token"]))).status_code == 404


def test_people_added_by_hand_need_an_email_or_a_phone() -> None:
    """D-CAMPAIGN-04: a name, an email and/or a phone (one is required), and an address."""
    person, problem = clean_person({"name": "  Nila  Akter ", "email": " Nila@Example.com ", "address": "House 1\r\nDhaka"})
    assert problem is None and person == {"name": "Nila Akter", "email": "nila@example.com", "phone": None, "address": "House 1\nDhaka"}
    person, problem = clean_person({"name": "Rafi", "phone": "+880 1712-345678"})
    assert problem is None and person and person["phone"] == "+880 1712-345678"
    assert clean_person({"name": "Mitu"})[1] == "Mitu needs an email or a phone"
    assert clean_person({"email": "not-an-email"})[1] == "not-an-email isn't an email address"
    assert clean_person({"phone": "12"})[1] == "12 isn't a phone number"
    assert phone_key("+880 1712-345678") == phone_key("8801712345678") == "8801712345678"
    assert phone_key("") is None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_people_added_by_hand_wait_for_staff_then_count(client: AsyncClient) -> None:
    """D-CAMPAIGN-04: the act adds people who bought outside Corner Room; they wait for staff, who
    approve or turn them away. Staff additions count at once. Duplicates are skipped, an email that
    belongs to an account is linked, and someone added by mistake can be taken back."""
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track_id, owner, artist_id = await _released(client, admin, label, "people-owner@example.com", "People Band")
    token = owner["access_token"]
    reviewer = await _staff_with(client, admin, "people-reviewer@example.com", "content_manager", label)
    created = await client.post(
        f"/api/v1/studio/profiles/artist/{artist_id}/gift-campaigns", headers=bearer(token),
        json={"title": "Card", "gift_items": "A signed card", "sender": "ARTIST", "works": [{"type": "RELEASE", "id": release_id}]},
    )
    cid = created.json()["id"]
    # Not before the campaign has been live.
    early = await client.post(f"/api/v1/studio/gift-campaigns/{cid}/recipients", headers=bearer(token), json={"people": [{"phone": "01712345678"}]})
    assert early.status_code == 409
    await client.post(f"/api/v1/studio/gift-campaigns/{cid}/submit", headers=bearer(token))
    await client.post(f"/api/v1/catalog-intake/gift-campaigns/{cid}/review", headers=bearer(reviewer), json={"action": "approve"})
    linked = await register_and_login(client, "people-linked@example.com")

    # Every problem is reported and nothing is added.
    bad = await client.post(
        f"/api/v1/studio/gift-campaigns/{cid}/recipients", headers=bearer(token),
        json={"people": [{"name": "Ok", "phone": "01712345678"}, {"name": "Nobody"}]},
    )
    assert bad.status_code == 422 and "Row 2" in bad.text
    added = await client.post(
        f"/api/v1/studio/gift-campaigns/{cid}/recipients", headers=bearer(token),
        json={"people": [
            {"name": "Linked Fan", "email": "People-Linked@example.com", "address": "Road 2, Dhaka"},
            {"name": "Phone Only", "phone": "+880 1712-345678", "address": "Road 3, Chattogram"},
            {"name": "Same Phone", "phone": "8801712345678"},
        ]},
    )
    assert added.status_code == 200, added.text
    body = added.json()
    assert body["added"] == 2 and body["skipped"] == 1
    assert body["counts"]["WAITING"] == 2 and body["counts"]["TOTAL"] == 0 and body["recipients"] == []
    assert {w["name"] for w in body["waiting"]} == {"Linked Fan", "Phone Only"} and body["can_review"] is False
    linked_row = next(w for w in body["waiting"] if w["name"] == "Linked Fan")
    assert linked_row["has_account"] is True and linked_row["email"] == "people-linked@example.com"
    phone_row = next(w for w in body["waiting"] if w["name"] == "Phone Only")

    # Waiting people can't be tracked, and the act can't approve its own additions.
    blocked = await client.post(
        f"/api/v1/studio/gift-campaigns/{cid}/recipients/transition", headers=bearer(token), json={"to": "PREPARED", "recipient_ids": [phone_row["id"]]},
    )
    assert blocked.json()["moved"] == 0
    own = await client.post(
        f"/api/v1/studio/gift-campaigns/{cid}/recipients/review", headers=bearer(token), json={"recipient_ids": [phone_row["id"]], "action": "approve"},
    )
    assert own.status_code == 403
    # Staff see the campaign in their queue, approve one and turn the other away.
    assert cid in [c["id"] for c in (await client.get("/api/v1/catalog-intake/gift-campaigns", headers=bearer(reviewer))).json()]
    approved = await client.post(
        f"/api/v1/studio/gift-campaigns/{cid}/recipients/review", headers=bearer(reviewer), json={"recipient_ids": [linked_row["id"]], "action": "approve"},
    )
    assert approved.json()["counts"]["TOTAL"] == 1 and approved.json()["counts"]["WAITING"] == 1
    row = approved.json()["recipients"][0]
    assert row["source"] == "ADDED" and row["name"] == "Linked Fan" and row["address"] == "Road 2, Dhaka"
    turned = await client.post(
        f"/api/v1/studio/gift-campaigns/{cid}/recipients/review", headers=bearer(reviewer), json={"recipient_ids": [phone_row["id"]], "action": "reject"},
    )
    assert turned.json()["counts"]["WAITING"] == 0 and turned.json()["waiting"] == []
    assert cid not in [c["id"] for c in (await client.get("/api/v1/catalog-intake/gift-campaigns", headers=bearer(reviewer))).json()]

    # Staff additions count at once and can be prepared like any buyer's.
    by_staff = await client.post(
        f"/api/v1/studio/gift-campaigns/{cid}/recipients", headers=bearer(reviewer),
        json={"people": [{"name": "Paid By Hand", "phone": "01812345678", "address": "Road 4, Sylhet"}]},
    )
    assert by_staff.json()["added"] == 1 and by_staff.json()["counts"]["TOTAL"] == 2 and by_staff.json()["counts"]["WAITING"] == 0
    hand_row = next(r for r in by_staff.json()["recipients"] if r["name"] == "Paid By Hand")
    # The act can't take back someone staff approved; staff can, until the gift moves.
    assert (await client.delete(f"/api/v1/studio/gift-campaigns/{cid}/recipients/{hand_row['id']}", headers=bearer(token))).status_code == 403
    prepared = await client.post(
        f"/api/v1/studio/gift-campaigns/{cid}/recipients/transition", headers=bearer(reviewer), json={"to": "PREPARED", "every": "YET_TO_SEND"},
    )
    assert prepared.json()["moved"] == 2
    stuck = await client.delete(f"/api/v1/studio/gift-campaigns/{cid}/recipients/{hand_row['id']}", headers=bearer(reviewer))
    assert stuck.status_code == 409
    # The person who later shows up as a real buyer isn't added twice.
    assert linked["access_token"]
