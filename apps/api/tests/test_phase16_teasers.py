"""Teasers end to end (owner, 2026-11-07, D-TEASER-00 to D-TEASER-04).

A teaser is cut from the song's own master, approved by staff, and then anyone can hear it, as
often as they like, before and after the song is released, while the song itself stays behind the
purchase check. The same teaser stays on the same song when the release goes out.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs, wav_bytes
from tests.test_audio_phase4_studio import _artist_for, _png, _upload
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _review


async def _draft_single(client: AsyncClient, token: str, artist_id: str, *, title: str = "Teased") -> tuple[str, str]:
    """A complete draft single with an 8 second master (long enough for a 5 s teaser)."""
    detail = (
        await client.post(
            "/api/v1/studio/releases", headers=bearer(token),
            json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": title},
        )
    ).json()
    release_id = detail["release"]["id"]
    await client.patch(
        f"/api/v1/studio/releases/{release_id}", headers=bearer(token),
        json={"language_code": "bn", "genre_primary": "adhunik", "p_line": "℗ 2026 A", "c_line": "© 2026 A"},
    )
    track_id = (
        await client.post(f"/api/v1/studio/releases/{release_id}/tracks", headers=bearer(token), json={"title": "Song"})
    ).json()["tracks"][0]["id"]
    version_id = (await client.post(f"/api/v1/studio/tracks/{track_id}/versions", headers=bearer(token))).json()["version_id"]
    await _upload(client, token, "AUDIO_MASTER", "track_version", version_id, wav_bytes(seconds=8.0), "song.wav")
    await _upload(client, token, "COVER_ART", "release_cover", release_id, _png(), "cover.png")
    await client.post(
        f"/api/v1/studio/releases/{release_id}/price-proposals", headers=bearer(token),
        json={"subject_type": "RELEASE", "subject_id": release_id, "amount_minor": 3000},
    )
    await _drain_jobs()
    return release_id, track_id


async def _release(client: AsyncClient, owner: str, reviewer: str, release_id: str) -> None:
    submitted = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(owner), json={"rights_declaration": True})
    assert submitted.status_code == 200, submitted.text
    for action in ("start_review", "approve", "release"):
        moved = await _review(client, reviewer, release_id, action)
        assert moved.status_code == 200, moved.text


async def _play_events(track_id: str) -> int:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.streaming.domain.models import PlaybackEvent

    async with get_session_factory()() as session:
        return int(await session.scalar(select(func.count()).select_from(PlaybackEvent).where(PlaybackEvent.track_id == track_id)))


async def _teaser_rows(track_id: str) -> int:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import Teaser

    async with get_session_factory()() as session:
        return int(await session.scalar(select(func.count()).select_from(Teaser).where(Teaser.track_id == track_id)))


async def _approve(client: AsyncClient, reviewer: str, teaser_id: str) -> None:
    done = await client.post(f"/api/v1/catalog-intake/teasers/{teaser_id}/review", headers=bearer(reviewer), json={"action": "approve"})
    assert done.status_code == 200, done.text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_teaser_before_and_after_release(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = (await register_and_login(client, "teaser-owner@example.com"))
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Teaser Artist")
    reviewer = await _staff_with(client, admin, "teaser-reviewer@example.com", "content_manager", label)
    fan = (await register_and_login(client, "teaser-fan@example.com"))["access_token"]
    other = await register_and_login(client, "teaser-other@example.com")
    await _artist_for(other["user"]["id"], label, name="Other Artist")
    release_id, track_id = await _draft_single(client, token, artist_id)

    # Only the song's own people can make a teaser; everyone else gets 404.
    for who in (fan, other["access_token"]):
        assert (await client.post(f"/api/v1/studio/tracks/{track_id}/teasers", headers=bearer(who), json={})).status_code == 404
    made = await client.post(f"/api/v1/studio/tracks/{track_id}/teasers", headers=bearer(token), json={"title": " First  listen "})
    assert made.status_code == 201, made.text
    teaser = made.json()
    teaser_id = teaser["id"]
    assert teaser["title"] == "First listen" and teaser["status"] == "DRAFT"
    assert teaser["versions"][0]["start_ms"] == 0 and teaser["versions"][0]["end_ms"] == teaser["master"]["duration_ms"]
    assert teaser["actions"] == ["process", "delete"] and teaser["limits"]["max_ms"] == 60_000
    assert (await client.get(f"/api/v1/studio/teasers/{teaser_id}", headers=bearer(other["access_token"]))).status_code == 404

    # Editor peaks are made once by the worker, never by the browser.
    wave = (await client.get(f"/api/v1/studio/tracks/{track_id}/waveform", headers=bearer(token))).json()
    assert wave["status"] == "PENDING"
    await _drain_jobs()
    wave = (await client.get(f"/api/v1/studio/tracks/{track_id}/waveform", headers=bearer(token))).json()
    assert wave["status"] == "READY" and len(wave["points"]) > 100 and max(wave["points"]) > 50

    # The artist hears the unreleased song through its playback copy, never the master.
    listen = await client.get(f"/api/v1/studio/tracks/{track_id}/listen?accept=opus,mp3", headers=bearer(token))
    assert listen.status_code == 200, listen.text
    song_bytes = await client.get(listen.json()["url"], headers={"Range": "bytes=0-99"})
    assert song_bytes.status_code == 206 and song_bytes.headers["content-type"].split(";")[0] in ("audio/ogg", "audio/mpeg")
    assert (await client.get(f"/api/v1/studio/tracks/{track_id}/listen", headers=bearer(fan))).status_code == 404

    # Settings are checked on the server.
    bad = await client.put(f"/api/v1/studio/teasers/{teaser_id}/draft", headers=bearer(token), json={"start_ms": 0, "end_ms": 9_000})
    assert bad.status_code == 422 and "END_AFTER_SONG" in bad.text
    short = await client.put(f"/api/v1/studio/teasers/{teaser_id}/draft", headers=bearer(token), json={"start_ms": 0, "end_ms": 4_000})
    assert short.status_code == 422 and "TOO_SHORT" in short.text
    saved = await client.put(
        f"/api/v1/studio/teasers/{teaser_id}/draft", headers=bearer(token),
        json={"start_ms": 1_000, "end_ms": 7_000, "fade_in_ms": 500, "fade_out_ms": 1_000, "gain_cdb": -300},
    )
    assert saved.status_code == 200, saved.text
    assert len(saved.json()["versions"]) == 1  # never processed: changed in place

    # Nothing goes to review before it is made; making it twice queues nothing new.
    assert (await client.post(f"/api/v1/studio/teasers/{teaser_id}/transition", headers=bearer(token), json={"action": "submit"})).status_code == 409
    assert (await client.post(f"/api/v1/studio/teasers/{teaser_id}/process", headers=bearer(token))).json()["versions"][0]["status"] == "PROCESSING"
    assert (await client.post(f"/api/v1/studio/teasers/{teaser_id}/process", headers=bearer(token))).status_code == 200
    await _drain_jobs()
    detail = (await client.get(f"/api/v1/studio/teasers/{teaser_id}", headers=bearer(token))).json()
    v1 = detail["versions"][0]
    assert v1["status"] == "READY" and abs(v1["duration_ms"] - 6_000) <= 150
    assert detail["actions"] == ["submit", "delete"]

    # The team hears the made version exactly as fans will.
    heard = await client.get(f"/api/v1/studio/teasers/{teaser_id}/versions/{v1['id']}/listen", headers=bearer(token))
    assert heard.status_code == 200 and (await client.get(heard.json()["url"])).status_code == 200

    # Not public until staff approve (D-TEASER-01).
    assert (await client.get(f"/api/v1/teasers/{teaser_id}")).status_code == 404
    sent = await client.post(f"/api/v1/studio/teasers/{teaser_id}/transition", headers=bearer(token), json={"action": "submit"})
    assert sent.json()["status"] == "IN_REVIEW" and sent.json()["actions"] == ["withdraw"]
    assert (await client.post(f"/api/v1/catalog-intake/teasers/{teaser_id}/review", headers=bearer(token), json={"action": "approve"})).status_code == 404
    queue = (await client.get("/api/v1/catalog-intake/teasers", headers=bearer(reviewer))).json()
    assert [q["teaser_id"] for q in queue] == [teaser_id] and queue[0]["profile_name"] == "Teaser Artist"
    no_note = await client.post(f"/api/v1/catalog-intake/teasers/{teaser_id}/review", headers=bearer(reviewer), json={"action": "return"})
    assert no_note.status_code == 422
    back = await client.post(
        f"/api/v1/catalog-intake/teasers/{teaser_id}/review", headers=bearer(reviewer),
        json={"action": "return", "note": "Start on the chorus, please."},
    )
    assert back.json()["status"] == "DRAFT"
    detail = (await client.get(f"/api/v1/studio/teasers/{teaser_id}", headers=bearer(token))).json()
    assert detail["versions"][0]["review_note"] == "Start on the chorus, please."
    await client.post(f"/api/v1/studio/teasers/{teaser_id}/transition", headers=bearer(token), json={"action": "submit"})
    await _approve(client, reviewer, teaser_id)

    # Before release: anyone hears it without an account; it names the song; the cover stays sealed.
    public = await client.get(f"/api/v1/teasers/{teaser_id}")
    assert public.status_code == 200, public.text
    view = public.json()
    assert view["track_title"] == "Song" and view["track_released"] is False and view["cover_url"] is None
    assert view["artist"] == "Teaser Artist" and view["next_step"]["kind"] == "NONE"
    on_release = (await client.get(f"/api/v1/releases/{release_id}/teasers")).json()["items"]
    assert [(t["id"], t["track_title"]) for t in on_release] == [(teaser_id, "Song")]
    audio = await client.get(f"/api/v1/teasers/{teaser_id}/audio?accept=mp3,opus")
    assert audio.status_code == 200, audio.text
    for _ in range(3):  # as often as they like
        heard = await client.get(audio.json()["url"], headers={"Range": "bytes=0-"})
        assert heard.status_code in (200, 206) and heard.headers["content-type"].split(";")[0] == "audio/mpeg"
    assert (await client.post(f"/api/v1/teasers/{teaser_id}/count", json={"kind": "start"})).status_code == 204

    # The song itself stays locked, and a teaser play is never a song play.
    assert (await client.get(f"/api/v1/playback/tracks/{track_id}/audio", headers=bearer(fan))).status_code in (403, 404, 409)
    assert await _play_events(track_id) == 0
    # Tokens never cross: a teaser token can't open song media, nor a studio token teaser media.
    teaser_token = audio.json()["url"].rsplit("/", 1)[1]
    assert (await client.get(f"/api/v1/playback/media/{teaser_token}")).status_code == 401
    studio_token = listen.json()["url"].rsplit("/", 1)[1]
    assert (await client.get(f"/api/v1/teasers/media/{studio_token}")).status_code == 401

    # Release: the same teaser stays on the same song, nothing is copied.
    await _release(client, token, reviewer, release_id)
    after = (await client.get(f"/api/v1/teasers/{teaser_id}")).json()
    assert after["id"] == teaser_id and after["track_id"] == track_id and after["track_released"] is True
    assert after["cover_url"]
    listed = (await client.get(f"/api/v1/tracks/{track_id}/teasers")).json()["items"]
    assert [t["id"] for t in listed] == [teaser_id]
    assert (await client.post("/api/v1/teasers/for-tracks", json={"track_ids": [track_id]})).json()["teasers"] == {track_id: teaser_id}
    assert await _teaser_rows(track_id) == 1

    # What a listener can do next comes from existing sources only.
    offers = (await client.get("/api/v1/offers")).json()["items"]
    on_sale = any(o.get("subject_id") == release_id for o in offers)
    fan_view = (await client.get(f"/api/v1/teasers/{teaser_id}", headers=bearer(fan))).json()
    assert fan_view["next_step"]["kind"] == ("BUY_RELEASE" if on_sale else "NONE")
    assert (await client.get(f"/api/v1/teasers/{teaser_id}", headers=bearer(token))).json()["next_step"]["kind"] == "OWNED"

    # A new version waits while the live one keeps playing; approving it retires the old one.
    edited = await client.put(f"/api/v1/studio/teasers/{teaser_id}/draft", headers=bearer(token), json={"start_ms": 2_000, "end_ms": 7_500})
    assert len(edited.json()["versions"]) == 2 and edited.json()["versions"][1]["is_live"] is True
    await client.post(f"/api/v1/studio/teasers/{teaser_id}/process", headers=bearer(token))
    await _drain_jobs()
    await client.post(f"/api/v1/studio/teasers/{teaser_id}/transition", headers=bearer(token), json={"action": "submit"})
    assert abs((await client.get(f"/api/v1/teasers/{teaser_id}")).json()["duration_ms"] - 6_000) <= 150
    await _approve(client, reviewer, teaser_id)
    detail = (await client.get(f"/api/v1/studio/teasers/{teaser_id}", headers=bearer(token))).json()
    newest, oldest = detail["versions"]
    assert newest["is_live"] and newest["number"] == 2 and oldest["retired_at"] is not None
    assert abs((await client.get(f"/api/v1/teasers/{teaser_id}")).json()["duration_ms"] - 5_500) <= 150
    # The old audio link stops once another version is live.
    assert (await client.get(audio.json()["url"])).status_code == 409

    # Unpublish and put back; staff can take it down too; a teaser that was public can't be deleted.
    off = await client.post(f"/api/v1/studio/teasers/{teaser_id}/transition", headers=bearer(token), json={"action": "unpublish"})
    assert off.json()["status"] == "UNPUBLISHED" and (await client.get(f"/api/v1/teasers/{teaser_id}")).status_code == 404
    on = await client.post(f"/api/v1/studio/teasers/{teaser_id}/transition", headers=bearer(token), json={"action": "republish"})
    assert on.json()["status"] == "PUBLISHED" and (await client.get(f"/api/v1/teasers/{teaser_id}")).status_code == 200
    staff_off = await client.post(f"/api/v1/catalog-intake/teasers/{teaser_id}/review", headers=bearer(reviewer), json={"action": "unpublish"})
    assert staff_off.json()["status"] == "UNPUBLISHED"
    assert (await client.delete(f"/api/v1/studio/teasers/{teaser_id}", headers=bearer(token))).status_code == 409

    overview = (await client.get(f"/api/v1/studio/releases/{release_id}/teasers", headers=bearer(token))).json()
    assert overview["songs"][0]["teasers"][0]["id"] == teaser_id
    assert overview["songs"][0]["teasers"][0]["counts"]["starts"] in (0, 1)  # dropped if Redis is down


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_teaser_after_release_and_failed_processing(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.documents.application import media_tools
    from cornerroom.modules.documents.domain.models import MediaJob
    from cornerroom.modules.music.domain.models import TrackVersion

    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "teaser-late@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Late Teaser")
    reviewer = await _staff_with(client, admin, "teaser-late-reviewer@example.com", "content_manager", label)
    release_id, track_id = await _draft_single(client, token, artist_id, title="Out Already")
    await _release(client, token, reviewer, release_id)

    teaser_id = (await client.post(f"/api/v1/studio/tracks/{track_id}/teasers", headers=bearer(token), json={})).json()["id"]
    await client.put(f"/api/v1/studio/teasers/{teaser_id}/draft", headers=bearer(token), json={"start_ms": 0, "end_ms": 6_000})

    # The tool fails until the job gives up: the version fails, the master and the settings stay.
    async def broken(*_args, **_kwargs):
        raise media_tools.MediaToolError("TEASER_FAILED", "simulated")

    monkeypatch.setattr(media_tools, "cut_teaser", broken)
    await client.post(f"/api/v1/studio/teasers/{teaser_id}/process", headers=bearer(token))
    await _drain_jobs()
    async with get_session_factory()() as session:
        jobs = (await session.execute(select(MediaJob).where(MediaJob.kind == "TEASER"))).scalars().all()
        for job in jobs:
            if job.status == "FAILED":
                job.attempts = job.max_attempts - 1
                job.next_attempt_at = job.created_at
        await session.commit()
    await _drain_jobs()
    detail = (await client.get(f"/api/v1/studio/teasers/{teaser_id}", headers=bearer(token))).json()
    assert detail["versions"][0]["status"] == "FAILED" and detail["versions"][0]["failure_code"]
    assert detail["versions"][0]["end_ms"] == 6_000 and "process" in detail["actions"]
    async with get_session_factory()() as session:
        master = (await session.execute(select(TrackVersion).where(TrackVersion.track_id == track_id))).scalar_one()
        assert master.status == "READY"
    assert (await client.get(f"/api/v1/tracks/{track_id}")).json()["status"] == "RELEASED"

    # Retrying reuses the same jobs (reset, not duplicated) and succeeds.
    monkeypatch.undo()
    await client.post(f"/api/v1/studio/teasers/{teaser_id}/process", headers=bearer(token))
    await _drain_jobs()
    async with get_session_factory()() as session:
        kinds = (await session.execute(select(func.count()).select_from(MediaJob).where(MediaJob.kind == "TEASER"))).scalar_one()
    detail = (await client.get(f"/api/v1/studio/teasers/{teaser_id}", headers=bearer(token))).json()
    assert detail["versions"][0]["status"] == "READY" and kinds == len(jobs)
    await client.post(f"/api/v1/studio/teasers/{teaser_id}/transition", headers=bearer(token), json={"action": "submit"})
    await _approve(client, reviewer, teaser_id)

    # Shows on the existing song page's list; the song keeps its id; still one teaser row.
    assert [t["id"] for t in (await client.get(f"/api/v1/tracks/{track_id}/teasers")).json()["items"]] == [teaser_id]
    assert (await client.get(f"/api/v1/teasers/{teaser_id}")).json()["track_released"] is True
    assert await _teaser_rows(track_id) == 1
