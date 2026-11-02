"""Early pre-sale (owner, 2026-11-03, D-PRESALE-03, option b): an artist opens a pre-sale from the
normal release editor before the audio or cover is ready. Staff approve just the title, artist, date
and pre-sale price; fans see only those; the release is finished and fully reviewed later. The
artist writes the release-day email in advance; staff approve it and it goes when the music is out."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.modules.commerce.application.onsite_presale import presale_listed, presale_open
from cornerroom.modules.commerce.domain.artist_mail import ArtistMail, ArtistMailMessage
from cornerroom.modules.music.domain.models import Release
from cornerroom.modules.notifications.domain.models import Notification
from cornerroom.worker import drain_outbox, release_scheduled, send_scheduled_artist_mail
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs, wav_bytes
from tests.test_audio_phase4_studio import _artist_for, _png, _upload
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _review
from tests.test_audio_phase7_release_commerce import _buy

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def test_early_presale_window() -> None:
    class R:
        deleted_at = None

        def __init__(self, status: str, at: datetime | None, presale: str | None = None) -> None:
            self.status, self.release_at, self.presale_status = status, at, presale

    soon = NOW + timedelta(days=3)
    # A draft with an approved early pre-sale is listed and open until its date.
    assert presale_listed(R("IN_PRODUCTION", soon, "APPROVED")) and presale_open(R("IN_PRODUCTION", soon, "APPROVED"), NOW)
    # Waiting for review or sent back: nothing public.
    assert not presale_listed(R("IN_PRODUCTION", soon, "REQUESTED"))
    assert not presale_listed(R("IN_PRODUCTION", soon, "RETURNED"))
    # The date passed while the music isn't finished: the page stays, pre-orders stop.
    late = R("METADATA_REVIEW", NOW - timedelta(hours=1), "APPROVED")
    assert presale_listed(late) and not presale_open(late, NOW)
    # Out, or no date: not a pre-sale any more.
    assert not presale_listed(R("RELEASED", soon, "APPROVED"))
    assert not presale_listed(R("APPROVED", None, "APPROVED"))


async def _finish(client: AsyncClient, token: str, release_id: str) -> str:
    """Add what the early pre-sale didn't need: details, a song with audio, a cover, a price; submit."""
    await client.patch(
        f"/api/v1/studio/releases/{release_id}", headers=bearer(token),
        json={"language_code": "bn", "genre_primary": "adhunik", "p_line": "℗ 2026 A", "c_line": "© 2026 A"},
    )
    track_id = (await client.post(f"/api/v1/studio/releases/{release_id}/tracks", headers=bearer(token), json={"title": "Song"})).json()["tracks"][0]["id"]
    version_id = (await client.post(f"/api/v1/studio/tracks/{track_id}/versions", headers=bearer(token))).json()["version_id"]
    await _upload(client, token, "AUDIO_MASTER", "track_version", version_id, wav_bytes(seconds=1.0), "song.wav")
    await _upload(client, token, "COVER_ART", "release_cover", release_id, _png(), "cover.png")
    await client.post(f"/api/v1/studio/releases/{release_id}/price-proposals", headers=bearer(token), json={"subject_type": "RELEASE", "subject_id": release_id, "amount_minor": 3000})
    await _drain_jobs()
    submitted = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(token), json={"rights_declaration": True})
    assert submitted.status_code == 200, submitted.text
    return track_id


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_early_presale_from_draft_to_release_day(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "ep-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Early Act")
    reviewer = await _staff_with(client, admin, "ep-reviewer@example.com", "content_manager", label)
    ops = await _staff_with(client, admin, "ep-ops@example.com", "finance_manager", label)
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)

    # A brand-new draft: a title only, no audio, no cover.
    created = await client.post(
        "/api/v1/studio/releases", headers=bearer(token),
        json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Night Signal"},
    )
    release_id = created.json()["release"]["id"]
    base = f"/api/v1/studio/releases/{release_id}"
    when = datetime.now(timezone.utc) + timedelta(days=5)
    presale = created.json()["presale"]
    assert presale["status"] is None and presale["can_request"]

    # A pre-sale price comes first, and the date needs a day's room.
    no_price = await client.post(f"{base}/presale/request", headers=bearer(token), json={"release_at": when.isoformat()})
    assert no_price.status_code == 409 and no_price.json()["code"] == "PRESALE_PRICE_REQUIRED"
    proposed = await client.post(
        f"{base}/price-proposals", headers=bearer(token),
        json={"subject_type": "RELEASE", "subject_id": release_id, "audience": "PRESALE", "amount_minor": 1500},
    )
    assert proposed.status_code in (200, 201), proposed.text
    too_soon = await client.post(f"{base}/presale/request", headers=bearer(token), json={"release_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()})
    assert too_soon.status_code == 422

    sent = await client.post(f"{base}/presale/request", headers=bearer(token), json={"release_at": when.isoformat()})
    assert sent.status_code == 200, sent.text
    assert sent.json()["presale"]["status"] == "REQUESTED" and sent.json()["presale"]["can_withdraw"]
    assert (await client.get(f"/api/v1/presales/releases/{release_id}")).status_code == 404
    # Fans would see the title: it can't change behind staff's back.
    locked = await client.patch(base, headers=bearer(token), json={"title": "Other Title"})
    assert locked.status_code == 409 and locked.json()["code"] == "PRESALE_LOCKED"

    # Staff see it waiting; the artist can't decide it; a return needs a note.
    queue = (await client.get("/api/v1/catalog-intake/presales", headers=bearer(reviewer))).json()
    assert [i["release_id"] for i in queue] == [release_id] and queue[0]["price"]["amount_minor"] == 1500
    review = f"/api/v1/catalog-intake/releases/{release_id}/presale/review"
    assert (await client.post(review, headers=bearer(token), json={"decision": "approve"})).status_code == 404
    assert (await client.post(review, headers=bearer(reviewer), json={"decision": "return"})).status_code == 422
    back = await client.post(review, headers=bearer(reviewer), json={"decision": "return", "note": "Pick an evening time"})
    assert back.status_code == 200, back.text
    view = (await client.get(base, headers=bearer(token))).json()["presale"]
    assert view["status"] == "RETURNED" and view["note"] == "Pick an evening time" and view["can_request"]

    # Sent again and approved: public only once the price is agreed too.
    assert (await client.post(f"{base}/presale/request", headers=bearer(token), json={"release_at": when.isoformat()})).status_code == 200
    approved = await client.post(review, headers=bearer(reviewer), json={"decision": "approve"})
    assert approved.status_code == 200, approved.text
    assert (await client.get(f"/api/v1/presales/releases/{release_id}")).status_code == 404
    pid = next(p["id"] for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json()
               if p["release_id"] == release_id and p["audience"] == "PRESALE")
    assert (await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(ops), json={"decision": "accept"})).status_code == 200
    page = (await client.get(f"/api/v1/presales/releases/{release_id}")).json()
    assert page["title"] == "Night Signal" and page["artist"] == "Early Act" and page["open"] is True
    assert page["cover_url"] is None and "tracks" not in page and page["offer"]["amount_minor"] == 1500
    view = (await client.get(base, headers=bearer(token))).json()["presale"]
    assert view["status"] == "APPROVED" and view["listed"] and view["open"] and view["price_live"]

    # A fan pre-orders the draft.
    fan = await register_and_login(client, "ep-fan@example.com")
    receipt = await _buy(client, fan["access_token"], page["offer"]["id"])
    assert receipt["is_presale"] is True

    # The release-day email: written now, approved by staff, waits for the release.
    saved = await client.put(f"{base}/presale/email", headers=bearer(token), json={"subject": "It's out, {first_name}", "body": "Thank you for waiting."})
    assert saved.status_code == 200, saved.text
    assert saved.json()["presale"]["email"]["status"] == "DRAFT"
    submitted = await client.post(f"{base}/presale/email/submit", headers=bearer(token))
    assert submitted.status_code == 200, submitted.text
    mail_id = submitted.json()["presale"]["email"]["id"]
    ok = await client.post(f"/api/v1/catalog-intake/artist-mails/{mail_id}/review", headers=bearer(reviewer), json={"action": "approve"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "SCHEDULED" and ok.json()["send_at"] is None and ok.json()["send_with_release_id"] == release_id

    # Staff move the date: the buyer is told.
    later = when + timedelta(days=2)
    moved = await client.post(review, headers=bearer(reviewer), json={"decision": "move_date", "release_at": later.isoformat()})
    assert moved.status_code == 200, moved.text
    while await drain_outbox({}):
        pass
    async with factory() as session:
        told = (await session.execute(select(Notification).where(Notification.type == "presale.date_changed"))).scalars().all()
    assert [str(n.user_id) for n in told] == [fan["user"]["id"]]

    # The artist finishes the music; staff review it in full and schedule it on the announced date.
    track_id = await _finish(client, token, release_id)
    for action in ("start_review", "approve"):
        assert (await _review(client, reviewer, release_id, action)).status_code == 200
    assert (await _review(client, reviewer, release_id, "schedule", release_at=later.isoformat())).status_code == 200
    assert (await client.get(f"/api/v1/presales/releases/{release_id}")).json()["open"] is True

    # Release day: it goes public, buyers are told, the prepared email goes out.
    async with factory() as session:
        await session.execute(update(Release).where(Release.id == release_id).values(release_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        await session.commit()
    assert await release_scheduled({}) == 1
    assert await send_scheduled_artist_mail({}) >= 1
    async with factory() as session:
        mail = await session.get(ArtistMail, mail_id)
        messages = (await session.execute(select(ArtistMailMessage).where(ArtistMailMessage.mail_id == mail.id))).scalars().all()
    assert mail.status in ("SENDING", "SENT") and [m.email for m in messages] == ["ep-fan@example.com"]
    assert messages[0].subject.startswith("It's out")
    playable = await client.post("/api/v1/playback/sessions", headers=bearer(fan["access_token"]), json={"track_id": track_id})
    assert playable.status_code == 201, playable.text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_early_presale_cancel_refunds_and_closes(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "epc-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Cancel Act")
    reviewer = await _staff_with(client, admin, "epc-reviewer@example.com", "content_manager", label)
    ops = await _staff_with(client, admin, "epc-ops@example.com", "finance_manager", label)
    release_id = (
        await client.post("/api/v1/studio/releases", headers=bearer(token), json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Maybe"})
    ).json()["release"]["id"]
    await client.post(
        f"/api/v1/studio/releases/{release_id}/price-proposals", headers=bearer(token),
        json={"subject_type": "RELEASE", "subject_id": release_id, "audience": "PRESALE", "amount_minor": 1000},
    )
    when = datetime.now(timezone.utc) + timedelta(days=4)
    assert (await client.post(f"/api/v1/studio/releases/{release_id}/presale/request", headers=bearer(token), json={"release_at": when.isoformat()})).status_code == 200
    assert (await client.post(f"/api/v1/catalog-intake/releases/{release_id}/presale/review", headers=bearer(reviewer), json={"decision": "approve"})).status_code == 200
    pid = next(p["id"] for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json() if p["release_id"] == release_id)
    assert (await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(ops), json={"decision": "accept"})).status_code == 200
    offer_id = (await client.get(f"/api/v1/presales/releases/{release_id}")).json()["offer"]["id"]
    fan = await register_and_login(client, "epc-fan@example.com")
    await _buy(client, fan["access_token"], offer_id)

    # Staff with catalog and finance rights cancel: refunds go to finance, the page closes.
    canceller = (await client.post(f"/api/v1/organizations/{label}/switch", headers=bearer(admin))).json()["access_token"]
    cancelled = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/presale/cancel", headers=bearer(canceller), json={"note": "Not this year"})
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["refunds_requested"] == 1 and cancelled.json()["buyers_told"] == 1
    assert (await client.get(f"/api/v1/presales/releases/{release_id}")).status_code == 404
    view = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    assert view["presale"]["status"] is None and view["release"]["status"] in ("IDEA", "DEMO", "IN_PRODUCTION", "QC")


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_released_too_early_goes_back_to_presale(client: AsyncClient) -> None:
    """Owner, 2026-11-03: a pre-sale released with Release now before its date can go back to
    pre-sale, unless someone has bought it at the normal price since."""
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "eb-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Early Back")
    reviewer = await _staff_with(client, admin, "eb-reviewer@example.com", "content_manager", label)
    ops = await _staff_with(client, admin, "eb-ops@example.com", "finance_manager", label)
    release_id = (
        await client.post("/api/v1/studio/releases", headers=bearer(token), json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Too Soon"})
    ).json()["release"]["id"]
    await client.post(
        f"/api/v1/studio/releases/{release_id}/price-proposals", headers=bearer(token),
        json={"subject_type": "RELEASE", "subject_id": release_id, "audience": "PRESALE", "amount_minor": 1200},
    )
    when = datetime.now(timezone.utc) + timedelta(days=6)
    assert (await client.post(f"/api/v1/studio/releases/{release_id}/presale/request", headers=bearer(token), json={"release_at": when.isoformat()})).status_code == 200
    assert (await client.post(f"/api/v1/catalog-intake/releases/{release_id}/presale/review", headers=bearer(reviewer), json={"decision": "approve"})).status_code == 200
    for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json():
        if p["release_id"] == release_id and p["status"] == "PROPOSED":
            assert (await client.post(f"/api/v1/offer-proposals/{p['id']}/decision", headers=bearer(ops), json={"decision": "accept"})).status_code == 200
    fan = await register_and_login(client, "eb-fan@example.com")
    await _buy(client, fan["access_token"], (await client.get(f"/api/v1/presales/releases/{release_id}")).json()["offer"]["id"])

    # Finished, approved, and then released at once by mistake.
    track_id = await _finish(client, token, release_id)
    for p in (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json():
        if p["release_id"] == release_id and p["status"] == "PROPOSED":
            assert (await client.post(f"/api/v1/offer-proposals/{p['id']}/decision", headers=bearer(ops), json={"decision": "accept"})).status_code == 200
    # Owner, 2026-11-03: the agreed normal price isn't in the Store until the music is out.
    listed = (await client.get("/api/v1/offers")).json()["items"]
    assert not [o for o in listed if o.get("subject_id") == release_id and o["audience"] == "EVERYONE"]
    for action in ("start_review", "approve", "release"):
        assert (await _review(client, reviewer, release_id, action)).status_code == 200
    assert (await client.get(f"/api/v1/presales/releases/{release_id}")).status_code == 404

    # The artist can't undo it; staff put it back on pre-sale for its date.
    back = f"/api/v1/catalog-intake/releases/{release_id}/back-to-presale"
    assert (await client.post(back, headers=bearer(token), json={})).status_code == 404
    undone = await client.post(back, headers=bearer(reviewer), json={})
    assert undone.status_code == 200, undone.text
    assert undone.json()["status"] == "SCHEDULED"
    listed = (await client.get("/api/v1/offers")).json()["items"]
    assert [o["audience"] for o in listed if o.get("subject_id") == release_id] == ["PRESALE"]
    page = (await client.get(f"/api/v1/presales/releases/{release_id}")).json()
    assert page["open"] is True and page["offer"]["amount_minor"] == 1200
    early = await client.post("/api/v1/playback/sessions", headers=bearer(fan["access_token"]), json={"track_id": track_id})
    assert early.status_code in (403, 404, 409)
    assert (await client.post(back, headers=bearer(reviewer), json={})).status_code == 409

    # Released early again, and someone buys it at the normal price: no going back now.
    assert (await _review(client, reviewer, release_id, "release")).status_code == 200
    normal = next(o for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id and o["audience"] == "EVERYONE")
    buyer = await register_and_login(client, "eb-buyer@example.com")
    await _buy(client, buyer["access_token"], normal["id"])
    refused = await client.post(back, headers=bearer(reviewer), json={})
    assert refused.status_code == 409 and refused.json()["code"] == "ALREADY_BOUGHT"
