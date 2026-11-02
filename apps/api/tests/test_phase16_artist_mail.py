"""Artist emails (owner, 2026-11-02, D-MAIL-01): buyers get the act's thank-you on purchase (always,
text editable and live at once); the act writes to buyers of chosen music (all, pre-sale or picked),
staff approve each email before Corner Room sends it, and buyers can stop an act's emails by link
or on /account. Artists see buyers' names only (D-BUYERS-01)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.settings import get_settings
from cornerroom.modules.commerce.application.artist_mail import buyer_email, buyer_ref, fill, music_line, thank_you_email
from cornerroom.modules.commerce.domain.models import PresaleClaim, Product
from cornerroom.worker import drain_outbox
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _buy, _released

WEB = "https://www.cornerroom.live/"


def test_fill_ins_and_music_line() -> None:
    values = {"buyer_name": "Rumi", "music": "Chaya Pore", "artist": "MIZULS"}
    assert fill("Hi {buyer_name}, thanks for {music}. {artist} {unknown} {}", values) == "Hi Rumi, thanks for Chaya Pore. MIZULS {unknown} {}"
    assert music_line([]) == "your music"
    assert music_line(["A"]) == "A"
    assert music_line(["A", "B"]) == "A and B"
    assert music_line(["A", "B", "C"]) == "A, B and C"
    assert music_line(["A", "B", "C", "D", "E"]) == "A, B, C and 2 more"


def test_thank_you_has_no_stop_link_and_buyer_email_does() -> None:
    values = {"buyer_name": "Rumi", "music": "Chaya Pore", "artist": "MIZULS"}
    subject, body = thank_you_email(subject="Thanks for {music}", body="Hi {buyer_name}", values=values, web_base_url=WEB)
    assert subject == "Thanks for Chaya Pore" and body.startswith("Hi Rumi\n")
    assert "email-stop" not in body and "https://www.cornerroom.live/purchases" in body and "aren't read" in body
    subject, body = buyer_email(subject="News", body="New song, {buyer_name}", values=values, web_base_url=WEB, stop_token="tok")
    assert subject == "News" and body.startswith("New song, Rumi\n")
    assert "Stop emails from MIZULS: https://www.cornerroom.live/email-stop/tok" in body


def test_buyer_ref_differs_per_act_and_hides_the_account() -> None:
    pid, other = uuid4(), uuid4()
    user = uuid4()
    ref = buyer_ref("artist", pid, f"user:{user}")
    assert ref == buyer_ref("artist", pid, f"user:{user}")
    assert ref != buyer_ref("artist", other, f"user:{user}")
    assert str(user) not in ref and len(ref) == 24


@pytest.fixture
def mailbox(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("DEV_MAILBOX_PATH", str(tmp_path))
    monkeypatch.setenv("WEB_BASE_URL", "http://localhost:3000")
    get_settings.cache_clear()
    yield tmp_path / "mailbox.jsonl"
    get_settings.cache_clear()


def _mail(box: Path) -> list[dict]:
    if not box.exists():
        return []
    return [json.loads(line) for line in box.read_text(encoding="utf-8").splitlines()]


async def _drain() -> None:
    while await drain_outbox({}):
        pass


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_thank_you_emails_to_buyers_review_and_stopping(client: AsyncClient, mailbox: Path) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, track_id, owner, artist_id = await _released(client, admin, label, "mail-owner@example.com", "Mail Band")
    token = owner["access_token"]
    ops = await _staff_with(client, admin, "mail-ops@example.com", "finance_manager", label)
    reviewer = await _staff_with(client, admin, "mail-reviewer@example.com", "content_manager", label)
    proposal = next(p for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json() if p["release_id"] == release_id)
    await client.post(f"/api/v1/offer-proposals/{proposal['id']}/decision", headers=bearer(ops), json={"decision": "accept"})
    offer = next(o for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)
    base = f"/api/v1/studio/profiles/artist/{artist_id}/mail"

    # Off until the act turns it on; the default text is offered.
    first = (await client.get(base, headers=bearer(token))).json()
    assert first["thank_you"]["on"] is False and "{music}" in first["thank_you"]["default_subject"]
    assert first["weekly_limit"] == 0 and first["viewer_role"] == "owner"
    early = await register_and_login(client, "mail-early@example.com")
    await _buy(client, early["access_token"], offer["id"])
    await _drain()
    assert [m for m in _mail(mailbox) if m["to"] == "mail-early@example.com" and "Mail Band" in m.get("from_name", "")] == []

    # On, with the act's own words: live at once, once per order, from "{Artist} via Corner Room".
    on = await client.put(f"{base}/thank-you", headers=bearer(token), json={"on": True, "body": "Hi {buyer_name}, thank you for {music}!"})
    assert on.status_code == 200 and on.json()["on"] is True and on.json()["body"].startswith("Hi {buyer_name}")
    fan = await register_and_login(client, "mail-fan@example.com")
    await _buy(client, fan["access_token"], offer["id"])
    await _drain()
    await _drain()
    thanks = [m for m in _mail(mailbox) if m["to"] == "mail-fan@example.com" and m.get("from_name") == "Mail Band via Corner Room"]
    assert len(thanks) == 1
    assert "thank you for Review Me!" in thanks[0]["body"] and "email-stop" not in thanks[0]["body"]
    assert (await client.get(base, headers=bearer(token))).json()["thank_you"]["sent_count"] == 1

    # A test goes to the asker's own address, marked as a test.
    test = await client.post(f"{base}/test", headers=bearer(token), json={"kind": "MANUAL", "subject": "Hello", "body": "Hi {buyer_name}"})
    assert test.status_code == 200
    await _drain()
    assert any(m["to"] == "mail-owner@example.com" and m["subject"] == "[Test] Hello" for m in _mail(mailbox))

    # A pre-sale buyer from before launch, at the sheet's address.
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        product = (await session.execute(select(Product).where(Product.subject_id == UUID(release_id)))).scalars().first()
        session.add(
            PresaleClaim(organization_id=UUID(label), product_id=product.id, email="sheet@example.com", buyer_name="Sheet Buyer",
                         amount_minor=1000, currency_code=offer["currency_code"], status="WAITING")
        )
        await session.commit()

    # Names only, for the song as well as the release (buying the release counts for its songs).
    names = (await client.get(f"{base}/buyers", headers=bearer(token), params={"work": [f"TRACK:{track_id}"]})).json()
    assert len(names) == 3 and all(set(b) == {"ref", "name", "presale"} for b in names)
    assert [b["presale"] for b in names if b["name"] == "Sheet Buyer"] == [True]
    audience = {"works": [{"type": "RELEASE", "id": release_id}], "who": "ALL"}
    assert (await client.post(f"{base}/reach", headers=bearer(token), json=audience)).json() == {"count": 3, "stopped": 0}
    presale = {**audience, "who": "PRESALE"}
    assert (await client.post(f"{base}/reach", headers=bearer(token), json=presale)).json()["count"] == 1

    # Saved templates.
    saved = await client.post(f"{base}/templates", headers=bearer(token), json={"name": "Everyone", "subject": "News", "body": "Hi", "audience": audience})
    assert saved.status_code == 201 and saved.json()["audience"]["works"][0]["title"] == "Review Me"
    assert [t["name"] for t in (await client.get(base, headers=bearer(token))).json()["templates"]] == ["Everyone"]

    # An email to everyone waits for staff; the act can't approve it; staff can.
    made = await client.post(
        f"/api/v1/studio/profiles/artist/{artist_id}/mails", headers=bearer(token),
        json={"subject": "New song soon", "body": "Hi {buyer_name}, something new from {artist} is coming.", "audience": audience},
    )
    assert made.status_code == 201, made.text
    mid = made.json()["id"]
    assert made.json()["status"] == "DRAFT"
    sent = await client.post(f"/api/v1/studio/mails/{mid}/submit", headers=bearer(token))
    assert sent.json()["status"] == "IN_REVIEW" and sent.json()["reach"]["count"] == 3
    assert (await client.patch(f"/api/v1/studio/mails/{mid}", headers=bearer(token), json={"subject": "x"})).status_code == 409
    queue = (await client.get("/api/v1/catalog-intake/artist-mails", headers=bearer(reviewer))).json()
    assert [m["id"] for m in queue] == [mid] and queue[0]["reach"]["count"] == 3
    own = await client.post(f"/api/v1/catalog-intake/artist-mails/{mid}/review", headers=bearer(token), json={"action": "approve"})
    assert own.status_code == 404
    no_note = await client.post(f"/api/v1/catalog-intake/artist-mails/{mid}/review", headers=bearer(reviewer), json={"action": "reject"})
    assert no_note.status_code == 422
    ok = await client.post(f"/api/v1/catalog-intake/artist-mails/{mid}/review", headers=bearer(reviewer), json={"action": "approve"})
    assert ok.status_code == 200 and ok.json()["status"] == "SENDING" and ok.json()["recipient_count"] == 3
    await _drain()
    out = [m for m in _mail(mailbox) if m["subject"] == "New song soon"]
    assert sorted(m["to"] for m in out) == ["mail-early@example.com", "mail-fan@example.com", "sheet@example.com"]
    assert all(m["from_name"] == "Mail Band via Corner Room" and "something new from Mail Band" in m["body"] for m in out)
    assert (await client.get(f"/api/v1/studio/mails/{mid}", headers=bearer(token))).json()["status"] == "SENT"

    # One click on the link stops this act's emails; /account shows it and can restart them.
    fan_mail = next(m for m in out if m["to"] == "mail-fan@example.com")
    stop = re.search(r"/email-stop/(\S+)", fan_mail["body"]).group(1)
    assert (await client.get(f"/api/v1/artist-mail/stop/{stop}")).json() == {"artist": "Mail Band", "stopped": False}
    assert (await client.post(f"/api/v1/artist-mail/stop/{stop}")).json() == {"artist": "Mail Band", "stopped": True}
    assert (await client.get("/api/v1/artist-mail/stop/not-a-token")).status_code == 404
    mine = (await client.get("/api/v1/me/artist-mail", headers=bearer(fan["access_token"]))).json()
    assert mine == [{"kind": "artist", "id": artist_id, "display_name": "Mail Band", "receiving": False}]

    # Picked people: someone who stopped is left out and counted.
    fan_ref = next(b["ref"] for b in names if b["name"] != "Sheet Buyer" and b["presale"] is False)
    picked = {**audience, "who": "PICKED", "picked": [b["ref"] for b in names]}
    assert (await client.post(f"{base}/reach", headers=bearer(token), json=picked)).json() == {"count": 2, "stopped": 1}
    assert fan_ref
    restarted = await client.put(f"/api/v1/me/artist-mail/artist/{artist_id}", headers=bearer(fan["access_token"]), json={"receiving": True})
    assert restarted.json()[0]["receiving"] is True
    assert (await client.post(f"{base}/reach", headers=bearer(token), json=picked)).json() == {"count": 3, "stopped": 0}

    # Outsiders see nothing.
    outsider = await register_and_login(client, "mail-outsider@example.com")
    assert (await client.get(base, headers=bearer(outsider["access_token"]))).status_code == 404
    assert (await client.get(f"/api/v1/studio/mails/{mid}", headers=bearer(outsider["access_token"]))).status_code == 404
