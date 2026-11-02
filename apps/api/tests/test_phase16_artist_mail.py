"""Artist emails (owner, 2026-11-02, D-MAIL-01 and D-MAIL-02).

Buyers get the act's thank-you on purchase: the most specific version that fits (everyone or
pre-sale buyers, any music or chosen songs and releases), always sent, live at once. The act writes
to buyers of chosen music, narrowed by filters and by ticking people in or out; staff approve each
email, which goes then or at its time. Emails are HTML with a plain-text copy, links inside the
text, the cover and a Listen button, and optional files; clicks are counted for the act's report.
Buyers can stop an act's emails by link or on /account. Artists see buyers' names only
(D-BUYERS-01)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.settings import get_settings
from cornerroom.modules.commerce.application.artist_mail import ArtistMailService, buyer_ref, specificity
from cornerroom.modules.commerce.application.artist_mail_render import (
    fill,
    music_line,
    parse,
    subject_line,
    values_for,
    write_email,
)
from cornerroom.modules.commerce.domain.models import PresaleClaim, Product
from cornerroom.worker import drain_outbox
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _buy, _released

WEB = "https://www.cornerroom.live/"


def _click(pos: int) -> str:
    return f"https://www.cornerroom.live/api/v1/artist-mail/c/tok/{pos}"


def test_fill_ins_names_and_music_line() -> None:
    values = values_for("Alam Hossain", ["Chaya Pore"], "MIZULS")
    assert values == {"buyer_name": "Alam Hossain", "first_name": "Alam", "music": "Chaya Pore", "artist": "MIZULS"}
    assert values_for(None, [], "MIZULS")["buyer_name"] == "friend" and values_for("  ", [], "X")["first_name"] == "friend"
    assert fill("Hi {first_name}, thanks for {music}. {artist} {unknown} {}", values) == "Hi Alam, thanks for Chaya Pore. MIZULS {unknown} {}"
    assert music_line([]) == "your music"
    assert music_line(["A", "B"]) == "A and B"
    assert music_line(["A", "B", "C"]) == "A, B and C"
    assert music_line(["A", "B", "C", "D", "E"]) == "A, B, C and 2 more"


def test_links_inside_text_are_parsed_and_only_real_addresses_count() -> None:
    tokens = parse("Hi {first_name}, watch [the video](https://youtu.be/x) or [this](javascript:alert(1)).")
    assert ("fill", "first_name") in tokens and ("link", "the video", "https://youtu.be/x") in tokens
    assert not any(t[0] == "link" and "javascript" in t[2] for t in tokens)
    assert subject_line("New from {artist}: [watch](https://a.b/c)", {"artist": "MIZULS"}) == "New from MIZULS: watch"


def test_email_has_html_and_text_copies_with_counted_links() -> None:
    values = values_for("Alam", ["Chaya Pore"], "MIZULS")
    written = write_email(
        kind="MANUAL", subject="Thank you for buying {music}", body="Hi {first_name},\n\nSee [the story](https://example.com/s) <b>now</b>.",
        values=values, click_url=_click, web_base_url=WEB, cover_url="https://www.cornerroom.live/api/v1/covers/tracks/t/480",
        listen=("https://www.cornerroom.live/tracks/t", "Chaya Pore"),
        files=[{"id": uuid4(), "name": "Poster.pdf", "kind": "FILE", "url": ""}], stop_url="https://www.cornerroom.live/email-stop/s",
    )
    assert written.subject == "Thank you for buying Chaya Pore"
    assert [link["kind"] for link in written.links] == ["LINK", "LISTEN", "FILE"]
    assert "See the story (https://www.cornerroom.live/api/v1/artist-mail/c/tok/0)" in written.text
    assert "Listen to Chaya Pore on Corner Room: https://www.cornerroom.live/api/v1/artist-mail/c/tok/1" in written.text
    assert "Download Poster.pdf: https://www.cornerroom.live/api/v1/artist-mail/c/tok/2" in written.text
    assert "Stop emails from MIZULS: https://www.cornerroom.live/email-stop/s" in written.text
    assert 'href="https://www.cornerroom.live/api/v1/artist-mail/c/tok/0"' in written.html
    assert "&lt;b&gt;now&lt;/b&gt;" in written.html and "<b>now</b>" not in written.html
    assert "covers/tracks/t/480" in written.html and "MIZULS" in written.html
    thanks = write_email(kind="THANK_YOU", subject="Thanks", body="Hi", values=values, click_url=_click, web_base_url=WEB)
    assert "email-stop" not in thanks.text and "https://www.cornerroom.live/purchases" in thanks.text and thanks.links == []


def test_most_specific_thank_you_wins() -> None:
    everyone = {"works": [], "who": "ALL"}
    presale = {"works": [], "who": "PRESALE"}
    one_song = {"works": [{"type": "TRACK", "id": "a"}], "who": "ALL"}
    one_song_presale = {"works": [{"type": "TRACK", "id": "a"}], "who": "PRESALE"}
    two = {"works": [{"type": "TRACK", "id": "a"}, {"type": "TRACK", "id": "b"}], "who": "ALL"}
    order = sorted([everyone, presale, one_song, one_song_presale, two], key=specificity)
    assert order == [everyone, presale, two, one_song, one_song_presale]


@pytest.mark.asyncio
async def test_thank_you_choice_without_chosen_music() -> None:
    svc = ArtistMailService.__new__(ArtistMailService)
    now = datetime.now(timezone.utc)
    general = SimpleNamespace(audience={"works": [], "who": "ALL"}, updated_at=now, created_at=now)
    early = SimpleNamespace(audience={"works": [], "who": "PRESALE"}, updated_at=now, created_at=now)
    assert await svc._choose_thank_you([general, early], set(), presale=True) is early
    assert await svc._choose_thank_you([general, early], set(), presale=False) is general
    assert await svc._choose_thank_you([early], set(), presale=False) is None


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


class _Later:
    def __init__(self, at: datetime) -> None:
        self.at = at

    def now(self) -> datetime:
        return self.at


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_thank_yous_emails_to_buyers_reports_and_stopping(client: AsyncClient, mailbox: Path) -> None:
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

    # No thank-you until the act writes one.
    first = (await client.get(base, headers=bearer(token))).json()
    assert first["thank_yous"] == [] and first["weekly_limit"] == 0 and first["viewer_role"] == "owner"
    early = await register_and_login(client, "mail-early@example.com")
    await _buy(client, early["access_token"], offer["id"])
    await _drain()
    assert [m for m in _mail(mailbox) if m["to"] == "mail-early@example.com" and "Mail Band" in m.get("from_name", "")] == []

    # A link kept elsewhere, given with emails.
    link_file = await client.post(f"{base}/file-links", headers=bearer(token), json={"name": "Poster", "url": "https://example.com/poster.pdf"})
    assert link_file.status_code == 201
    file_id = link_file.json()["id"]
    bad = await client.post(f"{base}/file-links", headers=bearer(token), json={"name": "X", "url": "ftp://nope"})
    assert bad.status_code == 422

    # Two versions: everyone, and this release only. The release one is more specific and wins.
    general = await client.post(f"{base}/thank-yous", headers=bearer(token), json={
        "audience": {"works": [], "who": "ALL"}, "subject": "Thanks", "body": "Hi {first_name}, thank you.",
    })
    assert general.status_code == 201, general.text
    special = await client.post(f"{base}/thank-yous", headers=bearer(token), json={
        "audience": {"works": [{"type": "RELEASE", "id": release_id}], "who": "ALL"}, "subject": "Thank you for buying {music}",
        "body": "Hi {buyer_name}, [read the story](https://example.com/story) behind {music}.", "file_ids": [file_id],
    })
    assert special.status_code == 201 and special.json()["audience"]["works"][0]["title"] == "Review Me"
    fan = await register_and_login(client, "mail-fan@example.com")
    await _buy(client, fan["access_token"], offer["id"])
    await _drain()
    await _drain()
    thanks = [m for m in _mail(mailbox) if m["to"] == "mail-fan@example.com" and m.get("from_name") == "Mail Band via Corner Room"]
    assert len(thanks) == 1 and thanks[0]["subject"] == "Thank you for buying Review Me"
    assert "read the story (" in thanks[0]["body"] and "email-stop" not in thanks[0]["body"] and "Open Poster" in thanks[0]["body"]
    assert "<html" in thanks[0]["html"] and "Review Me" in thanks[0]["html"]
    listing = (await client.get(base, headers=bearer(token))).json()["thank_yous"]
    assert [t["sent_count"] for t in listing] == [0, 1]

    # A click on the story link is counted and goes on to the address; a file link opens the file.
    story = re.search(r"read the story \((\S+)\)", thanks[0]["body"]).group(1)
    path = story.split("localhost:3000")[-1]
    opened = await client.get(path, follow_redirects=False)
    assert opened.status_code == 302 and opened.headers["location"] == "https://example.com/story"
    poster = re.search(r"Open Poster: (\S+)", thanks[0]["body"]).group(1).split("localhost:3000")[-1]
    assert (await client.get(poster, follow_redirects=False)).headers["location"] == "https://example.com/poster.pdf"
    assert (await client.get("/api/v1/artist-mail/c/nope/0", follow_redirects=False)).status_code == 404

    # A test goes to the asker's own address, filled in as the previewed buyer.
    test = await client.post(f"{base}/test", headers=bearer(token), json={
        "kind": "MANUAL", "subject": "Hello {first_name}", "body": "Hi {buyer_name}", "preview": {"name": "Alam Khan", "music": ["Review Me"]},
    })
    assert test.status_code == 200
    await _drain()
    assert any(m["to"] == "mail-owner@example.com" and m["subject"] == "[Test] Hello Alam" for m in _mail(mailbox))

    # A pre-sale buyer from before launch, at the sheet's address.
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        product = (await session.execute(select(Product).where(Product.subject_id == UUID(release_id)))).scalars().first()
        session.add(
            PresaleClaim(organization_id=UUID(label), product_id=product.id, email="sheet@example.com", buyer_name="Sheet Buyer",
                         amount_minor=1000, currency_code=offer["currency_code"], status="WAITING")
        )
        await session.commit()

    # People: names only, what they bought, for the song as well as the release.
    song = {"works": [{"type": "TRACK", "id": track_id}]}
    people = (await client.post(f"{base}/people", headers=bearer(token), json=song)).json()
    assert people["reach"] == {"count": 3, "stopped": 0}
    assert all(set(p) == {"ref", "name", "has_name", "presale", "bought", "picked", "stopped"} for p in people["people"])
    assert all(p["bought"] == ["Song"] and p["picked"] for p in people["people"])
    sheet = next(p for p in people["people"] if p["name"] == "Sheet Buyer")
    assert sheet["presale"] is True
    audience = {"works": [{"type": "RELEASE", "id": release_id}], "who": "ALL"}
    assert (await client.post(f"{base}/reach", headers=bearer(token), json=audience)).json() == {"count": 3, "stopped": 0}
    assert (await client.post(f"{base}/reach", headers=bearer(token), json={**audience, "who": "PRESALE"})).json()["count"] == 1
    # Filters: returning buyers (none here), dates, leaving out buyers of something, ticking.
    assert (await client.post(f"{base}/reach", headers=bearer(token), json={**audience, "buyer_type": "RETURNING"})).json()["count"] == 0
    assert (await client.post(f"{base}/reach", headers=bearer(token), json={**audience, "bought_to": "2000-01-01"})).json()["count"] == 0
    left_out = {**audience, "exclude_works": [{"type": "TRACK", "id": track_id}]}
    assert (await client.post(f"{base}/reach", headers=bearer(token), json=left_out)).json()["count"] == 0
    only_sheet = {**audience, "pick": {"mode": "ONLY", "refs": [sheet["ref"]]}}
    assert (await client.post(f"{base}/reach", headers=bearer(token), json=only_sheet)).json()["count"] == 1
    all_but_sheet = {**audience, "pick": {"mode": "ALL_BUT", "refs": [sheet["ref"]]}}
    assert (await client.post(f"{base}/reach", headers=bearer(token), json=all_but_sheet)).json()["count"] == 2
    assert (await client.post(f"{base}/reach", headers=bearer(token), json={**audience, "pick": {"mode": "ONLY", "refs": []}})).status_code == 422

    # Saved templates keep the occasion and files.
    saved = await client.post(f"{base}/templates", headers=bearer(token), json={
        "name": "Everyone", "subject": "News", "body": "Hi", "audience": audience, "occasion": "NEW_RELEASE", "file_ids": [file_id],
    })
    assert saved.status_code == 201 and saved.json()["occasion"] == "NEW_RELEASE" and saved.json()["file_ids"] == [file_id]

    # An email to everyone, scheduled for later: staff approve, it waits, then goes at its time.
    later = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    made = await client.post(f"/api/v1/studio/profiles/artist/{artist_id}/mails", headers=bearer(token), json={
        "subject": "New song soon, {first_name}", "body": "Hi {buyer_name}, something new from {artist}: [teaser](https://example.com/t).",
        "audience": audience, "send_at": later, "occasion": "NEW_RELEASE",
    })
    assert made.status_code == 201, made.text
    mid = made.json()["id"]
    sent = await client.post(f"/api/v1/studio/mails/{mid}/submit", headers=bearer(token))
    assert sent.json()["status"] == "IN_REVIEW" and sent.json()["reach"]["count"] == 3
    assert (await client.patch(f"/api/v1/studio/mails/{mid}", headers=bearer(token), json={"subject": "x"})).status_code == 409
    queue = (await client.get("/api/v1/catalog-intake/artist-mails", headers=bearer(reviewer))).json()
    assert [m["id"] for m in queue] == [mid] and queue[0]["send_at"] is not None
    assert (await client.post(f"/api/v1/catalog-intake/artist-mails/{mid}/review", headers=bearer(token), json={"action": "approve"})).status_code == 404
    assert (await client.post(f"/api/v1/catalog-intake/artist-mails/{mid}/review", headers=bearer(reviewer), json={"action": "reject"})).status_code == 422
    ok = await client.post(f"/api/v1/catalog-intake/artist-mails/{mid}/review", headers=bearer(reviewer), json={"action": "approve"})
    assert ok.status_code == 200 and ok.json()["status"] == "SCHEDULED"
    await _drain()
    assert [m for m in _mail(mailbox) if m["subject"].startswith("New song soon")] == []
    async with factory() as session:
        assert await ArtistMailService(session, clock=_Later(datetime.now(timezone.utc) + timedelta(hours=3))).send_due() == 1
        await session.commit()
    await _drain()
    out = [m for m in _mail(mailbox) if m["subject"].startswith("New song soon")]
    assert sorted(m["to"] for m in out) == ["mail-early@example.com", "mail-fan@example.com", "sheet@example.com"]
    assert all(m["from_name"] == "Mail Band via Corner Room" and "something new from Mail Band" in m["body"] for m in out)
    assert next(m for m in out if m["to"] == "sheet@example.com")["subject"] == "New song soon, Sheet"
    assert (await client.get(f"/api/v1/studio/mails/{mid}", headers=bearer(token))).json()["status"] == "SENT"

    # The fan clicks the teaser, then stops this act's emails; the report counts both.
    fan_mail = next(m for m in out if m["to"] == "mail-fan@example.com")
    teaser = re.search(r"teaser \((\S+)\)", fan_mail["body"]).group(1).split("localhost:3000")[-1]
    await client.get(teaser, follow_redirects=False)
    await client.get(teaser, follow_redirects=False)
    stop = re.search(r"/email-stop/(\S+)", fan_mail["body"]).group(1)
    assert (await client.get(f"/api/v1/artist-mail/stop/{stop}")).json() == {"artist": "Mail Band", "stopped": False}
    assert (await client.post(f"/api/v1/artist-mail/stop/{stop}")).json() == {"artist": "Mail Band", "stopped": True}
    report = (await client.get(f"/api/v1/studio/mails/{mid}/report", headers=bearer(token))).json()
    assert report["sent"] == 3 and report["clicks"] == 2 and report["people_clicked"] == 1 and report["stops"] == 1
    assert report["links"][0]["label"] == "teaser" and report["links"][0]["people"] == 1 and report["timeline"]
    dashboard = (await client.get(f"{base}/report", headers=bearer(token), params={"days": 30})).json()
    assert dashboard["emails_sent"] == 3 and dashboard["thank_yous_sent"] == 1 and dashboard["stops"] == 1
    assert len(dashboard["series"]) == 30 and dashboard["campaigns"][0]["people_clicked"] == 1

    # A copy is a new draft with the same words.
    copy = await client.post(f"/api/v1/studio/mails/{mid}/copy", headers=bearer(token))
    assert copy.status_code == 201 and copy.json()["status"] == "DRAFT" and copy.json()["subject"] == "New song soon, {first_name}"

    # /account shows the stop and can restart it; someone who stopped is left out and counted.
    mine = (await client.get("/api/v1/me/artist-mail", headers=bearer(fan["access_token"]))).json()
    assert mine == [{"kind": "artist", "id": artist_id, "display_name": "Mail Band", "receiving": False}]
    assert (await client.post(f"{base}/reach", headers=bearer(token), json=audience)).json() == {"count": 2, "stopped": 1}
    restarted = await client.put(f"/api/v1/me/artist-mail/artist/{artist_id}", headers=bearer(fan["access_token"]), json={"receiving": True})
    assert restarted.json()[0]["receiving"] is True
    assert (await client.post(f"{base}/reach", headers=bearer(token), json=audience)).json() == {"count": 3, "stopped": 0}

    # Outsiders see nothing.
    outsider = await register_and_login(client, "mail-outsider@example.com")
    assert (await client.get(base, headers=bearer(outsider["access_token"]))).status_code == 404
    assert (await client.get(f"/api/v1/studio/mails/{mid}", headers=bearer(outsider["access_token"]))).status_code == 404
    assert (await client.get(f"/api/v1/studio/mails/{mid}/report", headers=bearer(outsider["access_token"]))).status_code == 404
