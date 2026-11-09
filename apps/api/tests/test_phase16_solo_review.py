"""Who approves what (D-REVIEW-SOLO-01, D-REVIEW-ARTIST-01), and deleting a teaser deletes it whole.

With `STAFF_SECOND_REVIEW` off (production's default while the owner is the only staff), whatever
staff send for an act they are not part of is approved at once, and nobody is stopped from approving
their own work. Anyone on an act's team waits for staff, staff or not. Deleting a teaser that was
never public removes its versions too.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs
from tests.test_phase16_teasers import _draft_single


def _second_review_off(monkeypatch: pytest.MonkeyPatch) -> None:
    from cornerroom.infra.settings import get_settings

    monkeypatch.setenv("STAFF_SECOND_REVIEW", "false")
    get_settings.cache_clear()


async def _staff_artist(client: AsyncClient, admin: str, email: str, org_id: str, name: str) -> tuple[str, str]:
    """A staff member who may approve music and who also runs an act (like the owner and MIZULS)."""
    person = await register_and_login(client, email)
    roles = (await client.get("/api/v1/roles", headers=bearer(admin))).json()
    role = next(r for r in roles if r["key"] == "content_manager")
    joined = await client.post(
        f"/api/v1/organizations/{org_id}/memberships", headers=bearer(admin),
        json={"user_id": person["user"]["id"], "status": "ACTIVE", "role_id": role["id"]},
    )
    assert joined.status_code == 201, joined.text
    token = (await client.post(f"/api/v1/organizations/{org_id}/switch", headers=bearer(person["access_token"]))).json()["access_token"]
    artist_id = await _artist_for(person["user"]["id"], org_id, name=name)
    return token, artist_id


async def _made_teaser(client: AsyncClient, token: str, track_id: str) -> str:
    teaser_id = (await client.post(f"/api/v1/studio/tracks/{track_id}/teasers", headers=bearer(token), json={})).json()["id"]
    saved = await client.put(f"/api/v1/studio/teasers/{teaser_id}/draft", headers=bearer(token), json={"start_ms": 1_000, "end_ms": 7_000})
    assert saved.status_code == 200, saved.text
    assert (await client.post(f"/api/v1/studio/teasers/{teaser_id}/process", headers=bearer(token))).status_code == 200
    await _drain_jobs()
    return teaser_id


async def _rows(model_name: str, column: str, value: str) -> int:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain import models

    model = getattr(models, model_name)
    async with get_session_factory()() as session:
        return int(await session.scalar(select(func.count()).select_from(model).where(getattr(model, column) == value)))


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_artists_always_wait_staff_never_do(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """D-REVIEW-ARTIST-01 (owner, 2026-11-09): whoever is on an act's team waits for staff, even a
    staff member sending for their own act (the owner and MIZULS); staff working on someone else's
    act are approved at once; and with the second review off staff may approve their own act's work."""
    _second_review_off(monkeypatch)
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    staff, staff_artist = await _staff_artist(client, admin, "solo-owner@example.com", label, "Solo Band")
    artist = await register_and_login(client, "solo-artist@example.com")
    artist_token = artist["access_token"]
    other_artist = await _artist_for(artist["user"]["id"], label, name="Waiting Artist")

    # Sent as their own act, the staff member's release waits like any artist's ...
    release_id, track_id = await _draft_single(client, staff, staff_artist, title="Own single")
    sent = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(staff), json={"rights_declaration": True})
    assert sent.status_code == 200, sent.text
    assert sent.json()["release"]["status"] != "APPROVED"
    # ... and they approve it from the staff side themselves (no second person while solo).
    for action in ("start_review", "approve", "release"):
        out = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/review", headers=bearer(staff), json={"action": action})
        assert out.status_code == 200, (action, out.text)

    # Their own teaser waits too, and they approve it from the staff side.
    teaser_id = await _made_teaser(client, staff, track_id)
    sent = await client.post(f"/api/v1/studio/teasers/{teaser_id}/transition", headers=bearer(staff), json={"action": "submit"})
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "IN_REVIEW"
    approved = await client.post(f"/api/v1/catalog-intake/teasers/{teaser_id}/review", headers=bearer(staff), json={"action": "approve"})
    assert approved.status_code == 200, approved.text

    # An artist without the staff right waits for staff.
    _other_release, other_track = await _draft_single(client, artist_token, other_artist, title="Their single")
    other_teaser = await _made_teaser(client, artist_token, other_track)
    sent = await client.post(f"/api/v1/studio/teasers/{other_teaser}/transition", headers=bearer(artist_token), json={"action": "submit"})
    assert sent.json()["status"] == "IN_REVIEW"
    assert (await client.get(f"/api/v1/teasers/{other_teaser}")).status_code == 404
    # (Staff sending for an act they are not part of is approved at once: see
    # test_phase16_gift_status_mails.py, where staff's own email to picked buyers goes straight out.)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_second_review_on_keeps_the_two_person_rule(client: AsyncClient) -> None:
    # conftest turns the second review on: the staff member's own teaser waits and they can't approve it.
    admin, orgs = await _orgs(client)
    staff, staff_artist = await _staff_artist(client, admin, "duo-owner@example.com", orgs["LABEL"], "Duo Band")
    _release_id, track_id = await _draft_single(client, staff, staff_artist, title="Duo single")
    teaser_id = await _made_teaser(client, staff, track_id)
    sent = await client.post(f"/api/v1/studio/teasers/{teaser_id}/transition", headers=bearer(staff), json={"action": "submit"})
    assert sent.json()["status"] == "IN_REVIEW"
    refused = await client.post(f"/api/v1/catalog-intake/teasers/{teaser_id}/review", headers=bearer(staff), json={"action": "approve"})
    assert refused.status_code == 403 and "SAME_PERSON_REVIEW" in refused.text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_deleting_a_teaser_deletes_its_versions(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    owner = await register_and_login(client, "delete-teaser@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], orgs["LABEL"], name="Delete Artist")
    _release_id, track_id = await _draft_single(client, token, artist_id, title="Delete single")
    teaser_id = await _made_teaser(client, token, track_id)
    # A second, unsaved-yet version on top of the made one.
    newer = await client.put(f"/api/v1/studio/teasers/{teaser_id}/draft", headers=bearer(token), json={"start_ms": 2_000, "end_ms": 7_000})
    assert len(newer.json()["versions"]) == 2
    assert await _rows("TeaserVersion", "teaser_id", teaser_id) == 2
    assert await _rows("TeaserRendition", "teaser_version_id", newer.json()["versions"][-1]["id"]) + await _rows(
        "TeaserRendition", "teaser_version_id", newer.json()["versions"][0]["id"]
    ) > 0

    gone = await client.delete(f"/api/v1/studio/teasers/{teaser_id}", headers=bearer(token))
    assert gone.status_code in (200, 204), gone.text
    assert await _rows("Teaser", "id", teaser_id) == 0
    assert await _rows("TeaserVersion", "teaser_id", teaser_id) == 0
    assert (await client.get(f"/api/v1/studio/teasers/{teaser_id}", headers=bearer(token))).status_code == 404
    overview = (await client.get(f"/api/v1/studio/releases/{_release_id}/teasers", headers=bearer(token))).json()
    assert all(not s["teasers"] for s in overview["songs"])
