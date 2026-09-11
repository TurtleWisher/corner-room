"""Phase 08 streaming. PostgreSQL tests skip when unavailable."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase07_catalog import _ready_version, _release_track, _workspace


async def _grant_catalog(client: AsyncClient, staff_token: str, user_token: str, ref_id: str) -> None:
    me = await client.get("/api/v1/me", headers=bearer(user_token))
    assert me.status_code == 200, me.text
    granted = await client.post(
        "/api/v1/entitlements/grants",
        headers=bearer(staff_token),
        json={
            "user_id": me.json()["id"],
            "entitlement_type": "ADMIN_GRANT",
            "ref_id": ref_id,
            "scope": "CATALOG",
        },
    )
    assert granted.status_code == 201, granted.text


async def _released_track(client: AsyncClient, token: str, title: str = "Playable") -> dict:
    created = await client.post("/api/v1/tracks", headers=bearer(token), json={"title": title})
    assert created.status_code == 201, created.text
    await _ready_version(client, token, created.json()["id"])
    return await _release_track(client, token, created.json()["id"], created.json()["version"])


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase08_authz_sessions_events_idor(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    admin_p = await _workspace(client, admin, platform["id"])
    track = await _released_track(client, admin_p, "River Live")
    track_id = track["id"]

    anon = await client.post("/api/v1/playback/sessions", json={"track_id": track_id})
    assert anon.status_code == 401

    fan = await register_and_login(client, "fan-a@example.com")
    fan_token = fan["access_token"]
    other = await register_and_login(client, "fan-b@example.com")
    other_token = other["access_token"]
    await _grant_catalog(client, admin_p, fan_token, track_id)

    opened = await client.post(
        "/api/v1/playback/sessions",
        headers=bearer(fan_token),
        json={"track_id": track_id, "device": "web"},
    )
    assert opened.status_code == 201, opened.text
    session = opened.json()
    assert session["status"] == "OPEN"
    assert session["catalog_playable"] is True
    assert "organization_id" not in session
    session_id = session["id"]

    stolen = await client.get(
        f"/api/v1/playback/sessions/{session_id}",
        headers=bearer(other_token),
    )
    assert stolen.status_code == 404

    audio = await client.get(
        f"/api/v1/playback/tracks/{track_id}/audio",
        headers=bearer(fan_token),
    )
    assert audio.status_code == 409
    assert audio.json()["code"] == "TRACK_AUDIO_UNAVAILABLE"

    event_id = str(uuid4())
    payload = {
        "client_event_id": event_id,
        "track_id": track_id,
        "session_id": session_id,
        "duration_ms": 12000,
        "completed": False,
    }
    first = await client.post(
        "/api/v1/playback/events",
        headers={**bearer(fan_token), "Idempotency-Key": "play-1"},
        json=payload,
    )
    assert first.status_code == 201, first.text
    assert first.json()["replayed"] is False
    assert first.json()["eligible_hint"] is None
    assert first.json()["duration_ms"] == 12000

    replay = await client.post(
        "/api/v1/playback/events",
        headers={**bearer(fan_token), "Idempotency-Key": "play-1"},
        json=payload,
    )
    assert replay.status_code == 201
    assert replay.json()["id"] == first.json()["id"]

    concurrent = await client.post(
        "/api/v1/playback/events",
        headers=bearer(fan_token),
        json={**payload, "duration_ms": 99999, "completed": True},
    )
    assert concurrent.status_code == 201
    assert concurrent.json()["id"] == first.json()["id"]
    assert concurrent.json()["replayed"] is True
    assert concurrent.json()["duration_ms"] == 12000

    batch = await client.post(
        "/api/v1/playback/events:batch",
        headers=bearer(fan_token),
        json={
            "events": [
                {
                    "client_event_id": str(uuid4()),
                    "track_id": track_id,
                    "session_id": session_id,
                    "duration_ms": 800,
                    "completed": False,
                }
            ]
        },
    )
    assert batch.status_code == 201, batch.text

    closed = await client.post(
        f"/api/v1/playback/sessions/{session_id}/close",
        headers=bearer(fan_token),
        json={"version": session["version"]},
    )
    assert closed.status_code == 200
    assert closed.json()["status"] == "CLOSED"

    identity_sessions = await client.get("/api/v1/me/sessions", headers=bearer(fan_token))
    assert identity_sessions.status_code == 200
    assert all(row["id"] != session_id for row in identity_sessions.json())


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase08_unreleased_takedown_version_catalog(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    admin_p = await _workspace(client, admin, platform["id"])
    fan = await register_and_login(client, "listener@example.com")
    fan_token = fan["access_token"]

    draft = await client.post("/api/v1/tracks", headers=bearer(admin_p), json={"title": "Draft Song"})
    assert draft.status_code == 201
    unreleased = await client.post(
        "/api/v1/playback/sessions",
        headers=bearer(fan_token),
        json={"track_id": draft.json()["id"]},
    )
    assert unreleased.status_code == 409
    assert unreleased.json()["code"] == "TRACK_NOT_RELEASED"

    playable = await _released_track(client, admin_p, "On Air")
    versions = await client.get(
        f"/api/v1/tracks/{playable['id']}/versions",
        headers=bearer(admin_p),
    )
    assert versions.status_code == 200, versions.text
    current = versions.json()["items"][0]
    superseded = await client.post(
        f"/api/v1/tracks/{playable['id']}/versions/{current['id']}/transition",
        headers=bearer(admin_p),
        json={"action": "supersede", "version": current["version"]},
    )
    assert superseded.status_code == 200, superseded.text
    missing_version = await client.post(
        "/api/v1/playback/sessions",
        headers=bearer(fan_token),
        json={"track_id": playable["id"]},
    )
    assert missing_version.status_code == 409
    assert missing_version.json()["code"] == "VERSION_NOT_READY"

    taken = await _released_track(client, admin_p, "Gone")
    down = await client.post(
        f"/api/v1/tracks/{taken['id']}/transition",
        headers=bearer(admin_p),
        json={"action": "takedown", "version": taken["version"]},
    )
    assert down.status_code == 200
    blocked = await client.post(
        "/api/v1/playback/sessions",
        headers=bearer(fan_token),
        json={"track_id": taken["id"]},
    )
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "TRACK_TAKEN_DOWN"

    album = await client.post(
        "/api/v1/releases",
        headers=bearer(admin_p),
        json={"title": "Mixed", "release_type": "ALBUM"},
    )
    released_child = await _released_track(client, admin_p, "A-side")
    draft_child = await client.post(
        "/api/v1/tracks", headers=bearer(admin_p), json={"title": "B-side draft"}
    )
    add1 = await client.post(
        f"/api/v1/releases/{album.json()['id']}/tracks",
        headers=bearer(admin_p),
        json={"track_id": released_child["id"], "position": 1},
    )
    assert add1.status_code == 201, add1.text
    add2 = await client.post(
        f"/api/v1/releases/{album.json()['id']}/tracks",
        headers=bearer(admin_p),
        json={"track_id": draft_child.json()["id"], "position": 2},
    )
    assert add2.status_code == 201, add2.text
    approved = await client.post(
        f"/api/v1/releases/{album.json()['id']}/transition",
        headers=bearer(admin_p),
        json={"action": "approve", "version": album.json()["version"]},
    )
    assert approved.status_code == 200, approved.text
    released_album = await client.post(
        f"/api/v1/releases/{album.json()['id']}/transition",
        headers=bearer(admin_p),
        json={"action": "release", "version": approved.json()["version"]},
    )
    assert released_album.status_code == 200
    assert released_album.json()["status"] == "RELEASED"

    playability = await client.get(
        f"/api/v1/playback/releases/{album.json()['id']}/tracks",
        headers=bearer(fan_token),
    )
    assert playability.status_code == 200, playability.text
    by_track = {row["track_id"]: row for row in playability.json()}
    assert by_track[released_child["id"]]["catalog_playable"] is True
    assert by_track[draft_child.json()["id"]]["catalog_playable"] is False
    assert by_track[draft_child.json()["id"]]["reason"] == "TRACK_NOT_RELEASED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase08_library_playlist_aggregates_idor(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    admin_p = await _workspace(client, admin, platform["id"])
    artist = await client.post(
        "/api/v1/artists",
        headers=bearer(admin_p),
        json={"stage_name": "Aggregate Voice"},
    )
    assert artist.status_code == 201
    track = await client.post(
        "/api/v1/tracks",
        headers=bearer(admin_p),
        json={"title": "Counted", "primary_artist_id": artist.json()["id"]},
    )
    await _ready_version(client, admin_p, track.json()["id"])
    released = await _release_track(client, admin_p, track.json()["id"], track.json()["version"])

    fan = await register_and_login(client, "like-fan@example.com")
    other = await register_and_login(client, "other-fan@example.com")
    await _grant_catalog(client, admin_p, fan["access_token"], released["id"])
    opened = await client.post(
        "/api/v1/playback/sessions",
        headers=bearer(fan["access_token"]),
        json={"track_id": released["id"]},
    )
    assert opened.status_code == 201
    played = await client.post(
        "/api/v1/playback/events",
        headers=bearer(fan["access_token"]),
        json={
            "client_event_id": str(uuid4()),
            "track_id": released["id"],
            "session_id": opened.json()["id"],
            "duration_ms": 4000,
            "completed": True,
        },
    )
    assert played.status_code == 201

    liked = await client.post(
        "/api/v1/me/library",
        headers=bearer(fan["access_token"]),
        json={"item_type": "track", "item_id": released["id"], "kind": "LIKE"},
    )
    assert liked.status_code == 201
    stolen_lib = await client.delete(
        f"/api/v1/me/library/{liked.json()['id']}",
        headers=bearer(other["access_token"]),
    )
    assert stolen_lib.status_code == 404

    playlist = await client.post(
        "/api/v1/playlists",
        headers=bearer(fan["access_token"]),
        json={"title": "Walk home"},
    )
    assert playlist.status_code == 201
    stolen_pl = await client.post(
        f"/api/v1/playlists/{playlist.json()['id']}/items",
        headers=bearer(other["access_token"]),
        json={"track_id": released["id"], "position": 1},
    )
    assert stolen_pl.status_code == 404

    aggregates = await client.get(
        f"/api/v1/artists/{artist.json()['id']}/play-aggregates",
        headers=bearer(admin_p),
    )
    assert aggregates.status_code == 200, aggregates.text
    body = aggregates.json()
    assert body["label"] == "all plays"
    assert body["eligibility"] == "not_computed"
    assert "user_id" not in body
    assert all("user_id" not in row for row in body["tracks"])
    assert body["tracks"][0]["play_count"] >= 1

    stranger = await client.get(
        f"/api/v1/artists/{artist.json()['id']}/play-aggregates",
        headers=bearer(other["access_token"]),
    )
    assert stranger.status_code == 404
