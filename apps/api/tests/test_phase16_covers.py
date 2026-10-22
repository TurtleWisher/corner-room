"""Official cover art (OD-05, owner 2026-10-23): the real cover shows wherever there is one."""

from __future__ import annotations

import io
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs


def _png(size: int) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (size, size), (44, 187, 118)).save(out, format="PNG")
    return out.getvalue()


async def _accepted_cover(release_id: str) -> str:
    """An accepted cover stored and attached, as the worker leaves it after its checks."""
    from cornerroom.infra.db import get_session_factory
    from cornerroom.infra.settings import get_settings
    from cornerroom.infra.storage import get_storage
    from cornerroom.modules.documents.domain.models import MediaAsset
    from cornerroom.modules.music.domain.models import Release

    key = f"catalog_art/covers/{uuid4()}/original"
    data = _png(1400)
    await get_storage(get_settings()).put(object_key=key, data=data, mime="image/png", storage_class="catalog_art")
    async with get_session_factory()() as session:
        asset = MediaAsset(
            storage_class="catalog_art", bucket="local", object_key=key, mime="image/png", byte_size=len(data),
            sha256="0" * 64, status="ACCEPTED", scan_status="INSPECTED", purpose="COVER_ART",
        )
        session.add(asset)
        await session.flush()
        release = await session.get(Release, UUID(release_id))
        release.cover_asset_id = asset.id
        await session.commit()
        return str(asset.id)


async def _release_everything(release_id: str, track_id: str) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import Release, Track

    async with get_session_factory()() as session:
        (await session.get(Release, UUID(release_id))).status = "RELEASED"
        (await session.get(Track, UUID(track_id))).status = "RELEASED"
        await session.commit()


def _size(body: bytes) -> tuple[int, int]:
    from PIL import Image

    with Image.open(io.BytesIO(body)) as image:
        return image.size


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_covers_are_public_once_released_and_signed_before(client: AsyncClient) -> None:
    _admin, orgs = await _orgs(client)
    owner = await register_and_login(client, "covers-owner@example.com")
    artist_id = await _artist_for(owner["user"]["id"], orgs["LABEL"], name="Cover Art")
    created = await client.post(
        "/api/v1/studio/releases",
        headers=bearer(owner["access_token"]),
        json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Square"},
    )
    release_id = created.json()["release"]["id"]
    assert created.json()["cover_url"] is None
    track_id = (
        await client.post(f"/api/v1/studio/releases/{release_id}/tracks", headers=bearer(owner["access_token"]), json={"title": "Square"})
    ).json()["tracks"][0]["id"]
    await _accepted_cover(release_id)

    # Before release: no public cover, but Studio hands its owner a signed link.
    assert (await client.get(f"/api/v1/covers/releases/{release_id}/480")).status_code == 404
    assert (await client.get(f"/api/v1/covers/tracks/{track_id}/480")).status_code == 404
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(owner["access_token"]))).json()
    assert detail["cover_url"].startswith("/api/v1/covers/signed/") and detail["cover_url"].endswith("/1200")
    card = (await client.get(f"/api/v1/studio/profiles/artist/{artist_id}/releases", headers=bearer(owner["access_token"]))).json()[0]
    assert card["cover_url"].endswith("/480")
    signed = await client.get(card["cover_url"])
    assert signed.status_code == 200 and signed.headers["content-type"] == "image/jpeg"
    assert signed.headers["cache-control"].startswith("private")
    assert _size(signed.content) == (480, 480)
    assert (await client.get("/api/v1/covers/signed/not-a-token/480")).status_code == 401

    # Released: the release and its song show the official cover to anyone, at the asked size.
    await _release_everything(release_id, track_id)
    public = await client.get(f"/api/v1/covers/releases/{release_id}/1200")
    assert public.status_code == 200 and public.headers["cache-control"].startswith("public")
    assert _size(public.content) == (1200, 1200)
    song = await client.get(f"/api/v1/covers/tracks/{track_id}/160")
    assert song.status_code == 200 and _size(song.content) == (160, 160)
    again = await client.get(f"/api/v1/covers/tracks/{track_id}/160")
    assert again.content == song.content  # the web copy is made once and kept
    assert (await client.get(f"/api/v1/covers/releases/{release_id}/333")).status_code == 404
    missing = await client.get(f"/api/v1/covers/releases/{uuid4()}/480")
    assert missing.status_code == 404 and missing.content == b""  # bare, so <img> just falls back
