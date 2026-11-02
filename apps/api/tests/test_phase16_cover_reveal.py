"""Early cover reveal (owner, 2026-11-02, D-COVER-02): a release's cover stays hidden from fans
until release, unless the artist shows it early, a chosen time before release or at once with
Reveal now. Once shown it can't be hidden again."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from httpx import AsyncClient

from cornerroom.modules.music.domain.cover_reveal import cover_revealed, lead_is_valid, reveal_at
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs
from tests.test_phase16_onsite_presales import _presale_release, _schedule

NOW = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)


def _release(lead: int | None = None, revealed: datetime | None = None, at: datetime | None = NOW + timedelta(days=3)) -> SimpleNamespace:
    return SimpleNamespace(cover_reveal_lead_minutes=lead, cover_revealed_at=revealed, release_at=at)


def test_reveal_rules() -> None:
    # Default: hidden until release.
    assert reveal_at(_release()) is None and not cover_revealed(_release(), NOW)
    # Two days before a release three days away: not yet; a day later it shows.
    two_days = _release(lead=2 * 24 * 60)
    assert reveal_at(two_days) == NOW + timedelta(days=1)
    assert not cover_revealed(two_days, NOW)
    assert cover_revealed(two_days, NOW + timedelta(days=1))
    # A lead with no release date waits for the date.
    assert reveal_at(_release(lead=120, at=None)) is None
    # Reveal now wins over any lead.
    assert cover_revealed(_release(lead=60, revealed=NOW), NOW)
    assert lead_is_valid(60) and lead_is_valid(30 * 24 * 60)
    assert not lead_is_valid(59) and not lead_is_valid(30 * 24 * 60 + 1)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_artist_reveals_cover_early(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    release_id, _track, owner, reviewer, _ops = await _presale_release(client, admin, orgs["LABEL"], "cr")
    base = f"/api/v1/studio/releases/{release_id}/cover-reveal"

    # Before a date is set, a reveal time can be chosen but Reveal now can't be pressed.
    view = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(owner))).json()["cover_reveal"]
    assert view["lead_minutes"] is None and view["can_change"] and not view["can_reveal_now"]
    assert (await client.post(f"{base}/now", headers=bearer(owner))).status_code == 409
    assert (await client.put(base, headers=bearer(owner), json={"lead_minutes": 30})).status_code == 422

    # Strangers can't touch it.
    stranger = await register_and_login(client, "cr-stranger@example.com")
    assert (await client.put(base, headers=bearer(stranger["access_token"]), json={"lead_minutes": 120})).status_code == 404
    assert (await client.post(f"{base}/now", headers=bearer(stranger["access_token"]))).status_code == 404

    # Scheduled three days out with "2 days before": fans don't see the cover yet.
    assert (await _schedule(client, reviewer, release_id, datetime.now(timezone.utc) + timedelta(days=3))).status_code == 200
    saved = await client.put(base, headers=bearer(owner), json={"lead_minutes": 2 * 24 * 60})
    assert saved.status_code == 200, saved.text
    reveal = saved.json()["cover_reveal"]
    assert reveal["lead_minutes"] == 2 * 24 * 60 and reveal["reveal_at"] and not reveal["revealed"] and reveal["can_reveal_now"]
    page = (await client.get(f"/api/v1/presales/releases/{release_id}")).json()
    assert page["cover_url"] is None

    # Reveal now: fans see it at once, and it can't be hidden or re-timed afterwards.
    now = await client.post(f"{base}/now", headers=bearer(owner))
    assert now.status_code == 200, now.text
    assert now.json()["cover_reveal"]["revealed"] and not now.json()["cover_reveal"]["can_change"]
    page = (await client.get(f"/api/v1/presales/releases/{release_id}")).json()
    assert page["cover_url"].startswith("/api/v1/covers/signed/")
    assert (await client.get(page["cover_url"])).status_code == 200
    assert "tracks" not in page
    late = await client.put(base, headers=bearer(owner), json={"lead_minutes": None})
    assert late.status_code == 409 and late.json()["code"] == "COVER_ALREADY_REVEALED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_lead_time_already_passed_is_refused(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    release_id, _track, owner, reviewer, _ops = await _presale_release(client, admin, orgs["LABEL"], "cl")
    # A release a day away and "3 days before": that moment has gone, so the artist is pointed to Reveal now.
    assert (await _schedule(client, reviewer, release_id, datetime.now(timezone.utc) + timedelta(days=1))).status_code == 200
    base = f"/api/v1/studio/releases/{release_id}/cover-reveal"
    passed = await client.put(base, headers=bearer(owner), json={"lead_minutes": 3 * 24 * 60})
    assert passed.status_code == 422 and passed.json()["code"] == "REVEAL_TIME_PASSED"
    assert (await client.get(f"/api/v1/presales/releases/{release_id}")).json()["cover_url"] is None
    # A shorter time is fine, and choosing "with the release" again clears it.
    assert (await client.put(base, headers=bearer(owner), json={"lead_minutes": 2 * 60})).status_code == 200
    cleared = await client.put(base, headers=bearer(owner), json={"lead_minutes": None})
    assert cleared.status_code == 200 and cleared.json()["cover_reveal"]["lead_minutes"] is None
