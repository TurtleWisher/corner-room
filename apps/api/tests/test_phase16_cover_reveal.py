"""Pre-sale cover switch (owner, 2026-11-07, D-COVER-03, replacing the timed reveal of D-COVER-02):
before release fans see the cover lightly blurred, made on the server, until the artist switches it
on; then as it is. It can be switched back off any time before release."""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from httpx import AsyncClient

from cornerroom.infra.settings import get_settings
from cornerroom.modules.documents.application.covers import SOFT_SIZE, CoverService, _resize
from cornerroom.modules.music.domain.cover_reveal import cover_revealed, reveal_at
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs
from tests.test_phase16_onsite_presales import _presale_release, _schedule

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)


def _release(lead: int | None = None, revealed: datetime | None = None, at: datetime | None = NOW + timedelta(days=3)) -> SimpleNamespace:
    return SimpleNamespace(cover_reveal_lead_minutes=lead, cover_revealed_at=revealed, release_at=at)


def test_switch_rules() -> None:
    # Off by default.
    assert reveal_at(_release()) is None and not cover_revealed(_release(), NOW)
    # On: shown from the moment it was switched on.
    assert cover_revealed(_release(revealed=NOW), NOW)
    # A lead time chosen under D-COVER-02 still counts from its moment.
    two_days = _release(lead=2 * 24 * 60)
    assert not cover_revealed(two_days, NOW) and cover_revealed(two_days, NOW + timedelta(days=1))


def test_soft_links_only_give_the_blurred_copy() -> None:
    from PIL import Image

    covers = CoverService(session=None, settings=get_settings(), storage=object())  # type: ignore[arg-type]
    asset = "0190f000-0000-7000-8000-000000000001"
    sharp = covers.signed_path(asset, 1200)  # type: ignore[arg-type]
    soft = covers.signed_path(asset, 1200, soft=True)  # type: ignore[arg-type]
    assert sharp.endswith("/1200") and soft.endswith(f"/{SOFT_SIZE}")
    assert covers.cover_from_token(sharp.split("/")[-2])[1] is False
    assert covers.cover_from_token(soft.split("/")[-2])[1] is True

    # A sharp checkerboard loses its hard edges in the soft copy, but keeps its size and colours.
    board = Image.new("RGB", (600, 600), "white")
    for x in range(0, 600, 20):
        for y in range(0, 600, 20):
            if (x + y) // 20 % 2:
                board.paste((0, 0, 0), (x, y, x + 20, y + 20))
    raw = io.BytesIO()
    board.save(raw, format="PNG")

    def edge(data: bytes) -> int:
        with Image.open(io.BytesIO(data)) as im:
            row = [im.convert("L").getpixel((x, 7 * im.height // 30)) for x in range(im.width)]
        return max(abs(a - b) for a, b in zip(row, row[1:]))

    assert edge(_resize(raw.getvalue(), 480)) > 150
    soft_bytes = _resize(raw.getvalue(), 480, soft=True)
    assert edge(soft_bytes) < 80
    with Image.open(io.BytesIO(soft_bytes)) as im:
        assert im.size == (480, 480)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_artist_switches_the_cover_on_and_off(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    release_id, _track, owner, reviewer, _ops = await _presale_release(client, admin, orgs["LABEL"], "cr")
    base = f"/api/v1/studio/releases/{release_id}/cover-reveal"
    page_url = f"/api/v1/presales/releases/{release_id}"
    # Fans' page opens once the pre-sale is scheduled.
    assert (await _schedule(client, reviewer, release_id, datetime.now(timezone.utc) + timedelta(days=3))).status_code == 200

    # Off by default: the Studio preview and the fans' page both give the blurred copy.
    view = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(owner))).json()["cover_reveal"]
    assert set(view) == {"revealed", "revealed_at", "can_switch", "preview_url"}
    assert not view["revealed"] and view["can_switch"] and view["preview_url"].endswith(f"/{SOFT_SIZE}")
    page = (await client.get(page_url)).json()
    assert page["cover_revealed"] is False and page["cover_url"].endswith(f"/{SOFT_SIZE}")
    soft = await client.get(page["cover_url"])
    assert soft.status_code == 200 and soft.headers["content-type"] == "image/jpeg"
    # The blurred link can't be turned into the sharp one by asking for another size.
    token = page["cover_url"].split("/")[-2]
    assert (await client.get(f"/api/v1/covers/signed/{token}/1200")).content == soft.content
    assert "tracks" not in page

    # Strangers can't switch it.
    stranger = await register_and_login(client, "cr-stranger@example.com")
    assert (await client.put(base, headers=bearer(stranger["access_token"]), json={"revealed": True})).status_code == 404

    # On: fans see the cover as it is.
    on = await client.put(base, headers=bearer(owner), json={"revealed": True})
    assert on.status_code == 200, on.text
    assert on.json()["cover_reveal"]["revealed"] and on.json()["cover_reveal"]["revealed_at"]
    page = (await client.get(page_url)).json()
    assert page["cover_revealed"] is True and page["cover_url"].endswith("/1200")
    sharp = await client.get(page["cover_url"])
    assert sharp.status_code == 200 and sharp.content != soft.content
    # Switching on twice changes nothing.
    assert (await client.put(base, headers=bearer(owner), json={"revealed": True})).status_code == 200

    # Off again: blurred again.
    off = await client.put(base, headers=bearer(owner), json={"revealed": False})
    assert off.status_code == 200 and not off.json()["cover_reveal"]["revealed"]
    page = (await client.get(page_url)).json()
    assert page["cover_revealed"] is False and page["cover_url"].endswith(f"/{SOFT_SIZE}")
