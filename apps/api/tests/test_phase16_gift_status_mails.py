"""The act's own collectible status emails (owner, 2026-11-07, D-CAMPAIGN-05): written in the
artist-email editor per campaign and status (Dispatched, Returned, Missing), approved by staff, then
sent to every buyer in place of Corner Room's wording. They always send (no stop link)."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.errors import AppError
from cornerroom.modules.commerce.application.artist_mail_render import write_email
from cornerroom.modules.commerce.application.gift_status_mails import DEFAULTS, check_words, unfinished, with_gift
from cornerroom.modules.notifications.domain.models import Notification, NotificationDelivery
from cornerroom.worker import drain_outbox
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _buy, _released


def test_words_are_checked() -> None:
    assert check_words("  A gift  is coming ", "\r\nHi {first_name}, {gift}\r\n") == ("A gift is coming", "Hi {first_name}, {gift}")
    for subject, body in (("", "x"), ("x", "  "), ("x" * 201, "x"), ("x", "Hi {shoe_size}")):
        with pytest.raises(AppError):
            check_words(subject, body)
    assert unfinished("x", "Hi [add the courier name]") and not unfinished("x", "Hi [the shop](https://example.com)")
    assert with_gift("Your {gift} left", "signed poster") == "Your signed poster left"
    # Corner Room's starting words greet the buyer and name the gift.
    assert all("{first_name}" in body and "{gift}" in body for _subject, body in DEFAULTS.values())


def test_status_emails_have_no_stop_link() -> None:
    written = write_email(
        kind="GIFT_UPDATE", subject="On its way", body="Hi {first_name}, see [the map](https://example.com/map).",
        values={"artist": "MIZULS", "music": "Chaya Pore", "buyer_name": "Rumi Das", "first_name": "Rumi"},
        click_url=lambda n: "https://example.com/map", web_base_url="https://cornerroom.example",
    )
    assert "Hi Rumi" in written.text and "https://example.com/map" in written.html
    assert "Stop emails" not in written.text and "/purchases" in written.text


class _Sender:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send(self, **kwargs: Any) -> str:
        self.sent.append(kwargs)
        return "ok"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_act_writes_status_email_staff_approve_and_it_sends(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track_id, owner, artist_id = await _released(client, admin, label, "smail-owner@example.com", "Mail Band")
    token = owner["access_token"]
    reviewer = await _staff_with(client, admin, "smail-reviewer@example.com", "content_manager", label)
    ops = await _staff_with(client, admin, "smail-ops@example.com", "finance_manager", label)
    proposal = next(p for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json() if p["release_id"] == release_id)
    await client.post(f"/api/v1/offer-proposals/{proposal['id']}/decision", headers=bearer(ops), json={"decision": "accept"})
    created = await client.post(
        f"/api/v1/studio/profiles/artist/{artist_id}/gift-campaigns", headers=bearer(token),
        json={"title": "Poster", "gift_items": "A signed poster", "sender": "ARTIST", "works": [{"type": "RELEASE", "id": release_id}]},
    )
    cid = created.json()["id"]
    await client.post(f"/api/v1/studio/gift-campaigns/{cid}/submit", headers=bearer(token))
    await client.post(f"/api/v1/catalog-intake/gift-campaigns/{cid}/review", headers=bearer(reviewer), json={"action": "approve"})
    fan = await register_and_login(client, "smail-fan@example.com")
    offer = next(o for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)
    await _buy(client, fan["access_token"], offer["id"])
    base = f"/api/v1/studio/gift-campaigns/{cid}/status-emails"

    # Corner Room's wording until the act writes its own.
    view = (await client.get(base, headers=bearer(token))).json()
    assert [i["status"] for i in view["items"]] == ["DISPATCHED", "RETURNED", "MISSING"]
    assert all(i["state"] is None and not i["live"] for i in view["items"]) and "gift" in view["fill_ins"]
    stranger = await register_and_login(client, "smail-stranger@example.com")
    assert (await client.get(base, headers=bearer(stranger["access_token"]))).status_code == 404

    # A draft with a part still to write can't go to staff.
    draft = await client.put(f"{base}/DISPATCHED", headers=bearer(token), json={"subject": "Your {gift} left", "body": "Hi {first_name}, [add courier]"})
    assert draft.status_code == 200 and draft.json()["items"][0]["state"] == "DRAFT"
    assert (await client.post(f"{base}/DISPATCHED/submit", headers=bearer(token))).status_code == 422
    words = "Hi {first_name}, your {gift} from {artist} left today. Track it [here](https://example.com/track)."
    await client.put(f"{base}/DISPATCHED", headers=bearer(token), json={"subject": "Your {gift} left", "body": words})
    sent_in = await client.post(f"{base}/DISPATCHED/submit", headers=bearer(token))
    assert sent_in.json()["items"][0]["state"] == "IN_REVIEW"

    # The act can't approve its own words; staff see the campaign waiting and approve.
    assert (await client.post(f"{base}/DISPATCHED/review", headers=bearer(token), json={"action": "approve"})).status_code == 404
    queue = (await client.get("/api/v1/catalog-intake/gift-campaigns", headers=bearer(reviewer))).json()
    assert next(c for c in queue if c["id"] == cid)["emails_waiting"] == 1
    assert (await client.post(f"{base}/DISPATCHED/review", headers=bearer(reviewer), json={"action": "reject"})).status_code == 422
    approved = await client.post(f"{base}/DISPATCHED/review", headers=bearer(reviewer), json={"action": "approve"})
    assert approved.status_code == 200, approved.text
    item = approved.json()["items"][0]
    assert item["state"] == "APPROVED" and item["live"] and item["live_body"] == words

    # An edit waits for staff while the approved words keep sending.
    edited = await client.put(f"{base}/DISPATCHED", headers=bearer(token), json={"subject": "New words", "body": "Hi {first_name}!"})
    item = edited.json()["items"][0]
    assert item["state"] == "DRAFT" and item["live"] and item["live_subject"] == "Your {gift} left"

    # Dispatching sends the act's approved words to the buyer by email; the in-app note stays and
    # sends no email of its own.
    sender = _Sender()
    monkeypatch.setattr("cornerroom.modules.notifications.infra.email.email_sender_for", lambda _settings: sender)
    detail = (await client.get(f"/api/v1/studio/gift-campaigns/{cid}", headers=bearer(token))).json()
    rid = detail["recipients"][0]["id"]
    move = f"/api/v1/studio/gift-campaigns/{cid}/recipients/transition"
    await client.post(move, headers=bearer(token), json={"to": "PREPARED", "recipient_ids": [rid]})
    assert (await client.post(move, headers=bearer(token), json={"to": "DISPATCHED", "recipient_ids": [rid]})).status_code == 200
    while await drain_outbox({}):
        pass
    mails = [m for m in sender.sent if m["to"] == "smail-fan@example.com"]
    assert len(mails) == 1
    assert mails[0]["subject"] == "Your A signed poster left"
    assert "your A signed poster from Mail Band left today" in mails[0]["body"] and "Stop emails" not in mails[0]["body"]
    assert mails[0]["from_name"] == "Mail Band via Corner Room" and mails[0]["html"]
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        note = (await session.execute(select(Notification).where(Notification.type == "gift.dispatched"))).scalars().first()
        assert note is not None
        email = (
            await session.execute(
                select(NotificationDelivery).where(NotificationDelivery.notification_id == note.id, NotificationDelivery.channel == "email")
            )
        ).scalar_one()
        assert email.status == "SUPPRESSED" and email.last_error == "artist_email"
    assert (await client.get(base, headers=bearer(token))).json()["items"][0]["sent_count"] == 1

    # Back to Corner Room's wording.
    reset = await client.delete(f"{base}/DISPATCHED", headers=bearer(token))
    assert reset.json()["items"][0]["state"] is None and not reset.json()["items"][0]["live"]
