"""People edit their own profile and picture (owner, 2026-10-23).

Fans: name and a square picture of at least 400 px, theirs at once and seen only by them.
Artists and band admins: name, bio and picture wait for staff of their label to approve; the
public profile changes only then. Owners can't approve their own change, strangers get 404.
"""

from __future__ import annotations

import hashlib
import io

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs
from tests.test_audio_phase4_studio import _artist_for, _band_with, _label_org


def _image(width: int, height: int) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (width, height), (44, 187, 118)).save(out, format="JPEG")
    return out.getvalue()


async def _upload(client: AsyncClient, token: str, target_type: str, target_id: str, data: bytes) -> int:
    intent = await client.post(
        "/api/v1/uploads/intents",
        headers=bearer(token),
        json={"purpose": "COVER_ART", "target_type": target_type, "target_id": target_id, "filename": "me.jpg", "byte_size": len(data)},
    )
    if intent.status_code != 201:
        return intent.status_code
    it = intent.json()
    for n in range(1, it["part_count"] + 1):
        chunk = data[(n - 1) * it["part_size"] : n * it["part_size"]]
        put = await client.put(
            f"/api/v1/uploads/intents/{it['id']}/parts/{n}",
            headers={**bearer(token), "X-Part-SHA256": hashlib.sha256(chunk).hexdigest()},
            content=chunk,
        )
        assert put.status_code == 200, put.text
    done = await client.post(f"/api/v1/uploads/intents/{it['id']}/complete", headers=bearer(token))
    assert done.status_code == 200, done.text
    await _drain_jobs()
    return 201


async def _label_staff(client: AsyncClient, org_id: str) -> str:
    admin = await admin_token(client)
    return (await client.post(f"/api/v1/organizations/{org_id}/switch", headers=bearer(admin))).json()["access_token"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_fan_edits_name_and_picture(client: AsyncClient) -> None:
    fan = await register_and_login(client, "profile-fan@example.com", display_name="Old Name")
    token, user_id = fan["access_token"], fan["user"]["id"]

    renamed = await client.patch("/api/v1/me", headers=bearer(token), json={"display_name": "  Nadia R  "})
    assert renamed.status_code == 200 and renamed.json()["display_name"] == "Nadia R"
    blank = await client.patch("/api/v1/me", headers=bearer(token), json={"display_name": "   "})
    assert blank.status_code == 422

    # Only your own account can take your picture.
    other = await register_and_login(client, "profile-other@example.com")
    assert await _upload(client, other["access_token"], "user_avatar", user_id, _image(600, 600)) == 404

    # Too small is turned down with the reason; 400 px square is fine.
    assert await _upload(client, token, "user_avatar", user_id, _image(300, 300)) == 201
    report = (await client.get("/api/v1/me/avatar-report", headers=bearer(token))).json()
    assert report["asset_status"] == "REJECTED"
    assert "COVER_TOO_SMALL" in {f["code"] for f in report["findings"]}
    assert (await client.get("/api/v1/me", headers=bearer(token))).json()["avatar_url"] is None

    assert await _upload(client, token, "user_avatar", user_id, _image(400, 400)) == 201
    report = (await client.get("/api/v1/me/avatar-report", headers=bearer(token))).json()
    assert report["asset_status"] == "ACCEPTED" and report["is_current"] is True
    assert report["findings"] == []  # no 3000 px recommendation for pictures
    me = (await client.get("/api/v1/me", headers=bearer(token))).json()
    assert me["avatar_url"].startswith("/api/v1/covers/signed/")
    assert (await client.get(me["avatar_url"])).status_code == 200

    removed = await client.patch("/api/v1/me", headers=bearer(token), json={"remove_avatar": True})
    assert removed.status_code == 200 and removed.json()["avatar_url"] is None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_artist_changes_wait_for_staff(client: AsyncClient) -> None:
    org = await _label_org(client)
    owner = await register_and_login(client, "profile-artist@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], org, name="Rumi Test")
    staff = await _label_staff(client, org)
    base = f"/api/v1/studio/profiles/artist/{artist_id}"

    # The old direct edit is closed to the artist: changes go through review.
    direct = await client.patch(f"/api/v1/artists/{artist_id}", headers=bearer(token), json={"bio": "sneaky"})
    assert direct.status_code == 403 and direct.json()["code"] == "PROFILE_REVIEW_REQUIRED"

    # Strangers can't see or change the profile, nor upload its picture.
    fan = await register_and_login(client, "profile-stranger@example.com")
    assert (await client.get(f"{base}/profile", headers=bearer(fan["access_token"]))).status_code == 404
    assert (await client.post(f"{base}/profile-changes", headers=bearer(fan["access_token"]), json={"bio": "x"})).status_code == 404
    assert await _upload(client, fan["access_token"], "artist_portrait", artist_id, _image(600, 600)) == 404

    nothing = await client.post(f"{base}/profile-changes", headers=bearer(token), json={"stage_name": "Rumi Test"})
    assert nothing.status_code == 422 and nothing.json()["code"] == "NOTHING_TO_CHANGE"

    saved = await client.post(
        f"{base}/profile-changes", headers=bearer(token), json={"stage_name": "Rumi", "bio": "Songs from Dhaka"}
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["profile"]["stage_name"] == "Rumi Test" and body["profile"]["bio"] is None
    assert body["pending"]["stage_name"] == "Rumi" and body["pending"]["bio"] == "Songs from Dhaka"

    # A picture joins the same waiting request; the public still sees nothing new.
    assert await _upload(client, token, "artist_portrait", artist_id, _image(800, 800)) == 201
    view = (await client.get(f"{base}/profile", headers=bearer(token))).json()
    assert view["pending"]["portrait_url"].startswith("/api/v1/covers/signed/")
    assert view["picture_report"]["asset_status"] == "ACCEPTED"
    public = (await client.get(f"/api/v1/artists/{artist_id}")).json()
    assert public["stage_name"] == "Rumi Test" and public["portrait_asset_id"] is None
    assert (await client.get(f"/api/v1/covers/artists/{artist_id}/480")).status_code == 404

    # Staff of the label see it; the artist can't approve their own change; fans can't decide.
    queue = (await client.get("/api/v1/profile-changes", headers=bearer(staff))).json()
    item = next(i for i in queue if i["profile"]["id"] == artist_id)
    request_id = item["request"]["id"]
    assert (await client.get("/api/v1/profile-changes", headers=bearer(token))).json() == []
    own = await client.post(f"/api/v1/profile-changes/{request_id}/transition", headers=bearer(token), json={"to": "APPROVED"})
    assert own.status_code == 403 and own.json()["code"] == "SAME_PERSON_REVIEW"
    stranger = await client.post(
        f"/api/v1/profile-changes/{request_id}/transition", headers=bearer(fan["access_token"]), json={"to": "APPROVED"}
    )
    assert stranger.status_code == 404
    no_note = await client.post(f"/api/v1/profile-changes/{request_id}/transition", headers=bearer(staff), json={"to": "REJECTED"})
    assert no_note.status_code == 422

    approved = await client.post(f"/api/v1/profile-changes/{request_id}/transition", headers=bearer(staff), json={"to": "APPROVED"})
    assert approved.status_code == 200, approved.text
    public = (await client.get(f"/api/v1/artists/{artist_id}")).json()
    assert public["stage_name"] == "Rumi" and public["bio"] == "Songs from Dhaka" and public["portrait_asset_id"]
    picture = await client.get(f"/api/v1/covers/artists/{artist_id}/480")
    assert picture.status_code == 200 and picture.headers["content-type"] == "image/jpeg"
    again = await client.post(f"/api/v1/profile-changes/{request_id}/transition", headers=bearer(staff), json={"to": "REJECTED", "note": "x"})
    assert again.status_code == 409

    # A rejected change keeps the public profile and tells the artist why.
    await client.post(f"{base}/profile-changes", headers=bearer(token), json={"bio": "All caps BIO"})
    request_id = (await client.get(f"{base}/profile", headers=bearer(token))).json()["pending"]["id"]
    rejected = await client.post(
        f"/api/v1/profile-changes/{request_id}/transition", headers=bearer(staff), json={"to": "REJECTED", "note": "Please write it normally"}
    )
    assert rejected.status_code == 200
    view = (await client.get(f"{base}/profile", headers=bearer(token))).json()
    assert view["pending"] is None and view["last_decision"]["review_note"] == "Please write it normally"
    assert (await client.get(f"/api/v1/artists/{artist_id}")).json()["bio"] == "Songs from Dhaka"

    # The artist can withdraw a waiting change, and remove the picture through review.
    await client.post(f"{base}/profile-changes", headers=bearer(token), json={"remove_portrait": True})
    pending = (await client.get(f"{base}/profile", headers=bearer(token))).json()["pending"]
    assert pending["remove_portrait"] is True
    withdrawn = await client.post(f"/api/v1/profile-changes/{pending['id']}/transition", headers=bearer(token), json={"to": "WITHDRAWN"})
    assert withdrawn.status_code == 200
    assert (await client.get(f"/api/v1/covers/artists/{artist_id}/480")).status_code == 200


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_band_admin_edits_band_and_members_cannot(client: AsyncClient) -> None:
    org = await _label_org(client)
    admin_user = await register_and_login(client, "profile-band-admin@example.com")
    member = await register_and_login(client, "profile-band-member@example.com")
    band_id = await _band_with(admin_user["user"]["id"], member["user"]["id"], org)
    base = f"/api/v1/studio/profiles/band/{band_id}"

    assert (await client.post(f"{base}/profile-changes", headers=bearer(member["access_token"]), json={"bio": "x"})).status_code == 404
    saved = await client.post(f"{base}/profile-changes", headers=bearer(admin_user["access_token"]), json={"stage_name": "Day Shift"})
    assert saved.status_code == 200 and saved.json()["pending"]["stage_name"] == "Day Shift"

    staff = await _label_staff(client, org)
    request_id = saved.json()["pending"]["id"]
    approved = await client.post(f"/api/v1/profile-changes/{request_id}/transition", headers=bearer(staff), json={"to": "APPROVED"})
    assert approved.status_code == 200, approved.text
    assert (await client.get(f"/api/v1/bands/{band_id}")).json()["name"] == "Day Shift"
