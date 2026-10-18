"""Audio Phase 4: the artist Studio (AUDIO_PHASE_1_DESIGN 3, 5.4 to 5.6, 9, 10.1).

A solo artist and a band admin create, fill in, upload to, price and submit releases; strangers,
non-admin band members and other artists get 404 (abuse cases A1 to A4).
"""

from __future__ import annotations

import hashlib
import io
from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs, wav_bytes


async def _label_org(client: AsyncClient) -> str:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    return next(row for row in orgs if row["type"] == "LABEL")["id"]


async def _artist_for(user_id: str, org_id: str | None, *, status: str = "ACTIVE", name: str = "Mizuls") -> str:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.artists.domain.models import Artist

    async with get_session_factory()() as session:
        artist = Artist(stage_name=name, status=status, claimed_user_id=UUID(user_id), primary_org_id=UUID(org_id) if org_id else None, legal_name="Private Legal Name")
        session.add(artist)
        await session.commit()
        return str(artist.id)


async def _band_with(admin_user: str, member_user: str, org_id: str) -> str:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.artists.domain.models import Band, BandMember

    async with get_session_factory()() as session:
        band = Band(name="Night Shift", status="ACTIVE", primary_org_id=UUID(org_id))
        session.add(band)
        await session.flush()
        session.add(BandMember(band_id=band.id, user_id=UUID(admin_user), status="ACTIVE", is_admin=True))
        session.add(BandMember(band_id=band.id, user_id=UUID(member_user), status="ACTIVE", is_admin=False))
        await session.commit()
        return str(band.id)


def _png(size: int = 1400) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (size, size), (30, 60, 120)).save(buf, format="PNG")
    return buf.getvalue()


async def _upload(client: AsyncClient, token: str, purpose: str, target_type: str, target_id: str, data: bytes, name: str) -> None:
    intent = await client.post(
        "/api/v1/uploads/intents",
        headers=bearer(token),
        json={"purpose": purpose, "target_type": target_type, "target_id": target_id, "filename": name, "byte_size": len(data)},
    )
    assert intent.status_code == 201, intent.text
    it = intent.json()
    for n in range(1, it["part_count"] + 1):
        chunk = data[(n - 1) * it["part_size"] : n * it["part_size"]]
        res = await client.put(
            f"/api/v1/uploads/intents/{it['id']}/parts/{n}",
            headers={**bearer(token), "X-Part-SHA256": hashlib.sha256(chunk).hexdigest()},
            content=chunk,
        )
        assert res.status_code == 200, res.text
    done = await client.post(f"/api/v1/uploads/intents/{it['id']}/complete", headers=bearer(token))
    assert done.status_code == 200, done.text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_solo_artist_makes_and_submits_a_single(client: AsyncClient) -> None:
    org = await _label_org(client)
    me = await register_and_login(client, "studio-solo@example.com")
    token = me["access_token"]
    artist_id = await _artist_for(me["user"]["id"], org)

    profiles = (await client.get("/api/v1/me/catalog-profiles", headers=bearer(token))).json()
    assert profiles == [{"kind": "artist", "id": artist_id, "display_name": "Mizuls", "status": "ACTIVE", "can_publish": True, "reason": None}]
    taxonomy = (await client.get("/api/v1/catalog/taxonomy", headers=bearer(token))).json()
    assert {"bangla_folk", "baul", "pop"} <= {g["key"] for g in taxonomy["genres"]}
    assert taxonomy["languages"][0]["code"] == "bn"

    created = await client.post(
        "/api/v1/studio/releases",
        headers=bearer(token),
        json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "  Kaal   Bela  "},
    )
    assert created.status_code == 201, created.text
    detail = created.json()
    release_id = detail["release"]["id"]
    assert detail["release"]["title"] == "Kaal Bela"
    assert detail["viewer_role"] == "owner" and detail["display_state"] == "DRAFT"
    assert detail["release"]["track_sales"] == "TRACKS_ALLOWED"  # a single is always sold
    assert "Private Legal Name" not in created.text
    assert detail["readiness"]["ready"] is False

    patched = await client.patch(
        f"/api/v1/studio/releases/{release_id}",
        headers=bearer(token),
        json={"version": detail["release"]["version"], "language_code": "bn", "genre_primary": "bangla_folk", "p_line": "℗ 2026 Mizuls", "c_line": "© 2026 Mizuls"},
    )
    assert patched.status_code == 200, patched.text
    stale = await client.patch(f"/api/v1/studio/releases/{release_id}", headers=bearer(token), json={"version": 1, "title": "x"})
    assert stale.status_code == 409
    bad = await client.patch(f"/api/v1/studio/releases/{release_id}", headers=bearer(token), json={"genre_primary": "not-a-genre"})
    assert bad.status_code == 422

    with_track = await client.post(f"/api/v1/studio/releases/{release_id}/tracks", headers=bearer(token), json={"title": "Kaal Bela"})
    assert with_track.status_code == 201, with_track.text
    track_id = with_track.json()["tracks"][0]["id"]
    second = await client.post(f"/api/v1/studio/releases/{release_id}/tracks", headers=bearer(token), json={"title": "Extra"})
    assert second.status_code == 422  # a single has one track

    credits = await client.put(
        f"/api/v1/studio/tracks/{track_id}/credits",
        headers=bearer(token),
        json={"credits": [
            {"role_key": "primary_artist", "artist_id": artist_id},
            {"role_key": "songwriter", "display_name": "Abdul Karim"},
            {"role_key": "performer", "artist_id": artist_id, "instrument": "Dotara"},
        ]},
    )
    assert credits.status_code == 200, credits.text
    assert [c["role_key"] for c in credits.json()["credits"]] == ["primary_artist", "songwriter", "performer"]
    featured_typed = await client.put(
        f"/api/v1/studio/tracks/{track_id}/credits",
        headers=bearer(token),
        json={"credits": [{"role_key": "featured_artist", "display_name": "Someone"}]},
    )
    assert featured_typed.status_code == 422  # performers must be artists on Corner Room

    version = await client.post(f"/api/v1/studio/tracks/{track_id}/versions", headers=bearer(token))
    assert version.status_code == 201, version.text
    await _upload(client, token, "AUDIO_MASTER", "track_version", version.json()["version_id"], wav_bytes(seconds=1.0), "kaal-bela.wav")
    await _upload(client, token, "COVER_ART", "release_cover", release_id, _png(), "cover.png")
    await _drain_jobs()

    price = await client.post(
        f"/api/v1/studio/releases/{release_id}/price-proposals",
        headers=bearer(token),
        json={"subject_type": "RELEASE", "subject_id": release_id, "amount_minor": 5000, "currency_code": "BDT"},
    )
    assert price.status_code == 201, price.text

    ready = (await client.get(f"/api/v1/studio/releases/{release_id}/readiness", headers=bearer(token))).json()
    assert ready["ready"] is True, ready
    no_rights = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(token), json={})
    assert no_rights.status_code == 422 and no_rights.json()["code"] == "RIGHTS_DECLARATION_REQUIRED"
    submitted = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(token), json={"rights_declaration": True})
    assert submitted.status_code == 200, submitted.text
    body = submitted.json()
    assert body["release"]["status"] == "METADATA_REVIEW" and body["display_state"] == "IN_REVIEW"
    assert body["tracks"][0]["status"] == "SUBMITTED" and body["release"]["rights_declared_at"]
    frozen = await client.patch(f"/api/v1/studio/releases/{release_id}", headers=bearer(token), json={"title": "Changed"})
    assert frozen.status_code == 409

    withdrawn = await client.post(f"/api/v1/studio/releases/{release_id}/withdraw", headers=bearer(token))
    assert withdrawn.status_code == 200 and withdrawn.json()["release"]["status"] == "IN_PRODUCTION"
    assert withdrawn.json()["tracks"][0]["status"] == "DRAFT"

    listing = (await client.get(f"/api/v1/studio/profiles/artist/{artist_id}/releases", headers=bearer(token))).json()
    assert [r["id"] for r in listing] == [release_id]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_album_order_and_track_prices(client: AsyncClient) -> None:
    org = await _label_org(client)
    me = await register_and_login(client, "studio-album@example.com")
    token = me["access_token"]
    artist_id = await _artist_for(me["user"]["id"], org, name="Album Maker")
    release = (
        await client.post(
            "/api/v1/studio/releases",
            headers=bearer(token),
            json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "ALBUM", "title": "Low Tide"},
        )
    ).json()
    release_id = release["release"]["id"]
    assert release["release"]["track_sales"] == "RELEASE_ONLY"
    ids = []
    for title in ("One", "Two", "Three"):
        detail = (await client.post(f"/api/v1/studio/releases/{release_id}/tracks", headers=bearer(token), json={"title": title})).json()
        ids.append(detail["tracks"][-1]["id"])
    reordered = await client.put(f"/api/v1/studio/releases/{release_id}/tracks/order", headers=bearer(token), json={"track_ids": [ids[2], ids[0], ids[1]]})
    assert reordered.status_code == 200, reordered.text
    assert [t["title"] for t in reordered.json()["tracks"]] == ["Three", "One", "Two"]
    assert [t["position"] for t in reordered.json()["tracks"]] == [1, 2, 3]
    missing = await client.put(f"/api/v1/studio/releases/{release_id}/tracks/order", headers=bearer(token), json={"track_ids": [ids[0], ids[1]]})
    assert missing.status_code == 422

    removed = await client.delete(f"/api/v1/studio/releases/{release_id}/tracks/{ids[2]}", headers=bearer(token))
    assert removed.status_code == 204
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()
    assert [(t["title"], t["position"]) for t in detail["tracks"]] == [("One", 1), ("Two", 2)]

    await client.patch(f"/api/v1/studio/releases/{release_id}", headers=bearer(token), json={"track_sales": "TRACKS_ALLOWED"})
    codes = {(i["code"], i["ok"]) for i in (await client.get(f"/api/v1/studio/releases/{release_id}/readiness", headers=bearer(token))).json()["items"]}
    assert ("TRACK_PRICE", False) in codes  # songs sold one by one need their own proposed price

    wrong = await client.post(
        f"/api/v1/studio/releases/{release_id}/price-proposals",
        headers=bearer(token),
        json={"subject_type": "TRACK", "subject_id": ids[2], "amount_minor": 1000},
    )
    assert wrong.status_code == 422  # removed from this release
    partial = await client.post(
        f"/api/v1/studio/releases/{release_id}/price-proposals",
        headers=bearer(token),
        json={"subject_type": "RELEASE", "subject_id": release_id, "audience": "OWNS_PART_OF_RELEASE", "amount_minor": 20000},
    )
    assert partial.status_code == 201 and partial.json()["status"] == "PROPOSED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_studio_isolation_a1_to_a4(client: AsyncClient) -> None:
    org = await _label_org(client)
    owner = await register_and_login(client, "studio-owner@example.com")
    other = await register_and_login(client, "studio-other@example.com")
    member = await register_and_login(client, "studio-member@example.com")
    artist_id = await _artist_for(owner["user"]["id"], org, name="Owner Artist")
    await _artist_for(other["user"]["id"], org, name="Other Artist")
    release = (
        await client.post(
            "/api/v1/studio/releases",
            headers=bearer(owner["access_token"]),
            json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "EP", "title": "Mine"},
        )
    ).json()
    release_id = release["release"]["id"]
    track = (await client.post(f"/api/v1/studio/releases/{release_id}/tracks", headers=bearer(owner["access_token"]), json={"title": "T"})).json()
    track_id = track["tracks"][0]["id"]
    stranger = bearer(other["access_token"])

    # A1: another artist cannot create for, or list, my profile.
    assert (await client.post("/api/v1/studio/releases", headers=stranger, json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "x"})).status_code == 404
    assert (await client.get(f"/api/v1/studio/profiles/artist/{artist_id}/releases", headers=stranger)).status_code == 404
    # A2: nor read or change my draft, tracks, credits, audio or prices.
    assert (await client.get(f"/api/v1/studio/releases/{release_id}", headers=stranger)).status_code == 404
    assert (await client.patch(f"/api/v1/studio/releases/{release_id}", headers=stranger, json={"title": "Hijack"})).status_code == 404
    assert (await client.patch(f"/api/v1/studio/tracks/{track_id}", headers=stranger, json={"title": "Hijack"})).status_code == 404
    assert (await client.put(f"/api/v1/studio/tracks/{track_id}/credits", headers=stranger, json={"credits": []})).status_code == 404
    assert (await client.post(f"/api/v1/studio/tracks/{track_id}/versions", headers=stranger)).status_code == 404
    assert (await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=stranger, json={"rights_declaration": True})).status_code == 404
    assert (await client.post(f"/api/v1/studio/releases/{release_id}/price-proposals", headers=stranger, json={"subject_type": "RELEASE", "subject_id": release_id, "amount_minor": 1})).status_code == 404
    assert (await client.get("/api/v1/studio/releases/" + release_id)).status_code == 401

    # A3/A4: a band admin publishes for the band; a non-admin member cannot.
    band_id = await _band_with(other["user"]["id"], member["user"]["id"], org)
    as_admin = await client.post("/api/v1/studio/releases", headers=stranger, json={"profile": {"kind": "band", "id": band_id}, "release_type": "SINGLE", "title": "Band Song"})
    assert as_admin.status_code == 201, as_admin.text
    as_member = await client.post("/api/v1/studio/releases", headers=bearer(member["access_token"]), json={"profile": {"kind": "band", "id": band_id}, "release_type": "SINGLE", "title": "Nope"})
    assert as_member.status_code == 404
    assert (await client.get(f"/api/v1/studio/releases/{as_admin.json()['release']['id']}", headers=bearer(member["access_token"]))).status_code == 404
    assert [p["kind"] for p in (await client.get("/api/v1/me/catalog-profiles", headers=stranger)).json()] == ["artist", "band"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_profile_must_be_active_and_affiliated(client: AsyncClient) -> None:
    org = await _label_org(client)
    pending = await register_and_login(client, "studio-pending@example.com")
    loose = await register_and_login(client, "studio-loose@example.com")
    pending_artist = await _artist_for(pending["user"]["id"], org, status="APPROVED", name="Pending")
    loose_artist = await _artist_for(loose["user"]["id"], None, name="Loose")
    cards = (await client.get("/api/v1/me/catalog-profiles", headers=bearer(pending["access_token"]))).json()
    assert cards[0]["can_publish"] is False and cards[0]["reason"] == "PROFILE_NOT_ACTIVE"
    # Not ACTIVE: the profile owns nothing yet (S1), so it is not found for Studio work.
    blocked = await client.post("/api/v1/studio/releases", headers=bearer(pending["access_token"]), json={"profile": {"kind": "artist", "id": pending_artist}, "release_type": "SINGLE", "title": "x"})
    assert blocked.status_code == 404
    unaffiliated = await client.post("/api/v1/studio/releases", headers=bearer(loose["access_token"]), json={"profile": {"kind": "artist", "id": loose_artist}, "release_type": "SINGLE", "title": "x"})
    assert unaffiliated.status_code == 409 and unaffiliated.json()["code"] == "CATALOG_AFFILIATION_REQUIRED"
