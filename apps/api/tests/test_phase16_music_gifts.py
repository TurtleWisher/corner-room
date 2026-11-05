"""Music gifts (owner, 2026-11-06, D-GIFT-MUSIC-01) and the staff feature updates log (D-UPDATES-01).

An artist gives released music free to chosen email addresses. Staff approve each gift. A verified
account owns the music at once through a ৳0 order (no money); an address with no account gets the
email and the music once it becomes a verified account. The feature updates log is staff only."""

from __future__ import annotations

import re
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from cornerroom.infra.errors import AppError
from cornerroom.modules.administration.domain.feature_updates import AREAS, FEATURES, UPDATE_KINDS, feature_updates
from cornerroom.modules.commerce.application.artist_mail_render import values_for, write_email
from cornerroom.modules.commerce.application.music_gifts import clean_people
from tests.auth_helpers import bearer, register_and_login, register_user
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _released
from tests.test_phase16_presales import _mark_verified, _verify_by_link

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# --- pure ------------------------------------------------------------------------------------------


def test_people_are_cleaned_once_each_and_bad_addresses_named() -> None:
    people = clean_people([
        {"email": " Friend@Example.com ", "name": "  Rumi   K "},
        "radio@example.com",
        {"email": "friend@example.com", "note": "Thanks for the show"},
        {"email": ""},
    ])
    assert people == [
        {"email": "friend@example.com", "name": "Rumi K", "note": "Thanks for the show"},
        {"email": "radio@example.com", "name": None, "note": None},
    ]
    with pytest.raises(AppError) as bad:
        clean_people([{"email": "not-an-address"}, {"email": "ok@example.com"}])
    assert "not-an-address" in bad.value.title and bad.value.extras["invalid"] == ["not-an-address"]
    assert clean_people(None) == []


def test_gift_email_for_an_account_and_for_an_address_with_none() -> None:
    values = values_for("Rumi Khan", ["Chaya Pore"], "MIZULS")
    common = dict(
        kind="GIFT", subject="A gift for you, {first_name}", body="Hi {first_name}, {music} is yours.", values=values,
        click_url=lambda pos: f"https://api.example.com/c/t/{pos}", web_base_url="https://www.example.com/",
        cover_url=None, stop_url="https://www.example.com/email-stop/s",
    )
    owned = write_email(**common, listen=("https://www.example.com/releases/1", "Chaya Pore"), note="See you at the show.")
    assert owned.subject == "A gift for you, Rumi"
    assert "Hi Rumi, Chaya Pore is yours." in owned.text and "See you at the show." in owned.text
    assert "Listen to Chaya Pore" in owned.text and "gave you music" in owned.text and "Stop emails from MIZULS" in owned.text
    assert owned.links[0]["kind"] == "LISTEN"

    waiting = write_email(**common, listen=None, claim=("https://www.example.com/register", "rumi@example.com"))
    assert "Create your free account" in waiting.html and "rumi@example.com" in waiting.text
    assert "Listen to" not in waiting.text
    assert waiting.links[0]["url"] == "https://www.example.com/register"


def test_feature_updates_are_well_formed_and_newest_first() -> None:
    ids = [f["id"] for f in FEATURES]
    assert len(ids) == len(set(ids))
    for f in FEATURES:
        assert f["area"] in AREAS and f["name"] and f["summary"] and f["description"] and f["audience"]
        assert f["updates"], f["id"]
        for u in f["updates"]:
            assert u["kind"] in UPDATE_KINDS and DATE.match(u["date"]) and u["title"] and u["details"], (f["id"], u)
    listed = feature_updates()
    last = [f["last_date"] for f in listed]
    assert last == sorted(last, reverse=True)
    for f in listed:
        dates = [u["date"] for u in f["updates"]]
        assert dates == sorted(dates, reverse=True) and f["first_date"] == dates[-1]
    assert {"music-gifts", "feature-updates-log"} <= set(ids)


# --- with the database -------------------------------------------------------------------------------


async def _orders(email: str) -> list[tuple[int, bool]]:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.commerce.domain.models import Order
    from cornerroom.modules.identity.domain.models import User

    async with get_session_factory()() as session:
        rows = (
            await session.execute(
                select(Order.total_amount_minor, Order.music_gift_id.is_not(None)).join(User, User.id == Order.user_id).where(func.lower(User.email) == email)
            )
        ).all()
        return [(int(a), bool(g)) for a, g in rows]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_music_gift_review_give_claim_and_report(client: AsyncClient) -> None:
    from cornerroom.worker import drain_outbox

    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track_id, owner, artist_id = await _released(client, admin, label, "mg-owner@example.com", "Gift Givers")
    token = owner["access_token"]
    reviewer = await _staff_with(client, admin, "mg-reviewer@example.com", "content_manager", label)

    friend = await register_and_login(client, "mg-friend@example.com")
    await _mark_verified("mg-friend@example.com")

    base = f"/api/v1/studio/profiles/artist/{artist_id}/music-gifts"
    # Only the act's released music; an outsider can't see or make the act's gifts.
    outsider = await register_and_login(client, "mg-outsider@example.com")
    assert (await client.get(base, headers=bearer(outsider["access_token"]))).status_code == 404
    bad = await client.post(base, headers=bearer(token), json={"title": "Bad", "works": [{"type": "RELEASE", "id": str(UUID(int=7))}]})
    assert bad.status_code == 422

    created = await client.post(
        base, headers=bearer(token),
        json={
            "title": "Friends", "works": [{"type": "RELEASE", "id": release_id}],
            "subject": "A gift for you, {first_name}", "body": "Hi {first_name}, {music} is yours.",
            "people": [
                {"email": "MG-Friend@example.com", "name": "Best Friend", "note": "Thanks for everything."},
                {"email": "mg-later@example.com"},
            ],
        },
    )
    assert created.status_code == 201, created.text
    gift = created.json()
    gid = gift["id"]
    assert gift["status"] == "DRAFT" and gift["counts"]["TOTAL"] == 2 and gift["works"][0]["title"] == "Review Me"
    assert {p["email"] for p in gift["people"]} == {"mg-friend@example.com", "mg-later@example.com"}

    # A draft changes; sent for review it can't, and its own artist can't approve it.
    changed = await client.patch(f"/api/v1/studio/music-gifts/{gid}", headers=bearer(token), json={"title": "Close friends"})
    assert changed.json()["title"] == "Close friends"
    assert (await client.post(f"/api/v1/studio/music-gifts/{gid}/submit", headers=bearer(token))).json()["status"] == "IN_REVIEW"
    assert (await client.patch(f"/api/v1/studio/music-gifts/{gid}", headers=bearer(token), json={"title": "x"})).status_code == 409
    queue = (await client.get("/api/v1/catalog-intake/music-gifts", headers=bearer(reviewer))).json()
    assert [g["id"] for g in queue] == [gid] and len(queue[0]["people"]) == 2
    assert (await client.post(f"/api/v1/catalog-intake/music-gifts/{gid}/review", headers=bearer(token), json={"action": "approve"})).status_code == 404
    back = await client.post(f"/api/v1/catalog-intake/music-gifts/{gid}/review", headers=bearer(reviewer), json={"action": "reject", "note": "Add a hello"})
    assert back.json()["status"] == "DRAFT" and back.json()["review_note"] == "Add a hello"
    await client.post(f"/api/v1/studio/music-gifts/{gid}/submit", headers=bearer(token))
    approved = await client.post(f"/api/v1/catalog-intake/music-gifts/{gid}/review", headers=bearer(reviewer), json={"action": "approve"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "SENT"
    assert approved.json()["counts"] == {"WAITING": 0, "GIVEN": 1, "WAITING_ACCOUNT": 1, "ALREADY_OWNED": 0, "TOTAL": 2}

    # The friend owns it through a ৳0 order marked as a gift; no money.
    ents = (await client.get("/api/v1/me/entitlements", headers=bearer(friend["access_token"]))).json()["items"]
    assert any(e["scope"] == "RELEASE" and e["ref_id"] == release_id and e["status"] == "ACTIVE" for e in ents)
    assert await _orders("mg-friend@example.com") == [(0, True)]

    # Both get an email (artist-email pipeline, kind GIFT); the report shows it.
    while await drain_outbox({}):
        pass
    detail = (await client.get(f"/api/v1/studio/music-gifts/{gid}", headers=bearer(token))).json()
    by_email = {p["email"]: p for p in detail["people"]}
    assert by_email["mg-friend@example.com"]["status"] == "GIVEN" and by_email["mg-friend@example.com"]["emailed_at"]
    assert by_email["mg-later@example.com"]["status"] == "WAITING_ACCOUNT"

    # The later address signs up and verifies: the music is theirs, once.
    later = await register_user(client, "mg-later@example.com")
    await _verify_by_link(client, later["id"])
    while await drain_outbox({}):
        pass
    detail = (await client.get(f"/api/v1/studio/music-gifts/{gid}", headers=bearer(token))).json()
    assert detail["counts"]["GIVEN"] == 2 and detail["counts"]["WAITING_ACCOUNT"] == 0
    assert await _orders("mg-later@example.com") == [(0, True)]

    # Given again (a copy): the friend already owns it, so no second order.
    copy = (await client.post(f"/api/v1/studio/music-gifts/{gid}/copy", headers=bearer(token))).json()
    assert copy["status"] == "DRAFT" and copy["counts"]["TOTAL"] == 2
    await client.patch(f"/api/v1/studio/music-gifts/{copy['id']}", headers=bearer(token), json={"people": [{"email": "mg-friend@example.com"}]})
    await client.post(f"/api/v1/studio/music-gifts/{copy['id']}/submit", headers=bearer(token))
    again = (await client.post(f"/api/v1/catalog-intake/music-gifts/{copy['id']}/review", headers=bearer(reviewer), json={"action": "approve"})).json()
    assert again["counts"]["ALREADY_OWNED"] == 1
    assert await _orders("mg-friend@example.com") == [(0, True)]

    # A draft can be thrown away; a sent gift can't.
    draft = (await client.post(base, headers=bearer(token), json={"title": "Scratch"})).json()
    assert (await client.delete(f"/api/v1/studio/music-gifts/{draft['id']}", headers=bearer(token))).status_code == 204
    assert (await client.delete(f"/api/v1/studio/music-gifts/{gid}", headers=bearer(token))).status_code == 409


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_feature_updates_are_for_staff_only(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    staff = await _staff_with(client, admin, "updates-staff@example.com", "content_manager", orgs["LABEL"])
    fan = await register_and_login(client, "updates-fan@example.com")
    assert (await client.get("/api/v1/staff/feature-updates", headers=bearer(fan["access_token"]))).status_code == 404
    listed = await client.get("/api/v1/staff/feature-updates", headers=bearer(staff))
    assert listed.status_code == 200, listed.text
    assert any(f["id"] == "music-gifts" for f in listed.json())
    assert (await client.get("/api/v1/staff/feature-updates")).status_code == 401
