"""Audio Phase 5: staff-assisted intake with privacy (AUDIO_PHASE_1_DESIGN 3.4, 3.5, 12 A17 to A22).

Staff prepare releases through catalog-only responses: no legal name, account email or user ids
of the artist. They cannot submit unless managed mode is on, which needs its own permission and a
written reason, and only inside their own workspace.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for

SECRET_LEGAL_NAME = "Private Legal Name"


async def _orgs(client: AsyncClient) -> tuple[str, dict[str, str]]:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    return admin, {row["type"]: row["id"] for row in orgs}


async def _staff_with(client: AsyncClient, admin: str, email: str, role_key: str, org_id: str) -> str:
    person = await register_and_login(client, email)
    roles = (await client.get("/api/v1/roles", headers=bearer(admin))).json()
    role = next(r for r in roles if r["key"] == role_key)
    joined = await client.post(
        f"/api/v1/organizations/{org_id}/memberships",
        headers=bearer(admin),
        json={"user_id": person["user"]["id"], "status": "ACTIVE", "role_id": role["id"]},
    )
    assert joined.status_code == 201, joined.text
    switched = await client.post(f"/api/v1/organizations/{org_id}/switch", headers=bearer(person["access_token"]))
    assert switched.status_code == 200, switched.text
    return switched.json()["access_token"]


def _no_private_data(text: str, *, email: str, user_id: str) -> None:
    assert SECRET_LEGAL_NAME not in text
    assert email not in text
    assert user_id not in text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_prepare_catalog_only_and_cannot_submit(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    artist_user = await register_and_login(client, "intake-artist@example.com")
    artist_id = await _artist_for(artist_user["user"]["id"], label, name="Shapla")
    assistant = await _staff_with(client, admin, "intake-assistant@example.com", "catalog_assistant", label)

    cards = await client.get("/api/v1/catalog-intake/profiles", headers=bearer(assistant), params={"q": "shap"})
    assert cards.status_code == 200, cards.text
    assert cards.json() == [{"kind": "artist", "id": artist_id, "display_name": "Shapla", "status": "ACTIVE", "has_owner": True}]
    _no_private_data(cards.text, email="intake-artist@example.com", user_id=artist_user["user"]["id"])

    created = await client.post(
        "/api/v1/studio/releases",
        headers=bearer(assistant),
        json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Prepared by staff"},
    )
    assert created.status_code == 201, created.text
    detail = created.json()
    assert detail["viewer_role"] == "staff" and detail["release"]["intake_mode"] == "ASSISTED"
    assert detail["intake"]["mode"] == "ASSISTED"
    # Exact catalog-only shapes (design 3.5): nothing else can leak through these responses.
    # cover_url: a signed link to the accepted cover, or null (OD-05, 2026-10-23); no storage key.
    assert set(detail) == {"release", "cover_url", "profile", "viewer_role", "display_state", "tracks", "readiness", "proposals", "intake", "history"}
    assert set(detail["profile"]) == {"kind", "id", "display_name"}
    assert set(detail["release"]) == {
        "id", "title", "release_type", "status", "release_at", "release_timezone", "cover_asset_id", "language_code",
        "genre_primary", "genre_secondary", "label_name", "p_line", "c_line", "upc", "track_sales", "intake_mode",
        "rights_declared_at", "version",
    }
    _no_private_data(created.text, email="intake-artist@example.com", user_id=artist_user["user"]["id"])
    release_id = detail["release"]["id"]
    added = await client.post(f"/api/v1/studio/releases/{release_id}/tracks", headers=bearer(assistant), json={"title": "One"})
    assert added.status_code == 201
    assert set(added.json()["tracks"][0]) == {
        "id", "position", "title", "version_title", "status", "explicit", "language_code", "genre_primary",
        "genre_secondary", "isrc", "version", "audio", "credits",
    }

    # A18: staff prepare, the artist submits.
    staff_submit = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(assistant), json={"rights_declaration": True})
    assert staff_submit.status_code == 403 and staff_submit.json()["code"] == "INTAKE_NOT_MANAGED"

    # The artist sees the same release, knows staff helped, and is the one who can submit.
    mine = await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(artist_user["access_token"]))
    assert mine.status_code == 200 and mine.json()["viewer_role"] == "owner"
    assert mine.json()["intake"]["mode"] == "ASSISTED"
    owner_submit = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(artist_user["access_token"]), json={"rights_declaration": True})
    assert owner_submit.status_code == 409 and owner_submit.json()["code"] == "RELEASE_NOT_READY"

    # The preparer is on record for the two-person rule (A17 is enforced at approval, Phase 6).
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import ReleaseContributor
    from sqlalchemy import select
    from uuid import UUID

    async with get_session_factory()() as session:
        rows = (await session.execute(select(ReleaseContributor).where(ReleaseContributor.release_id == UUID(release_id)))).scalars().all()
        assert len(rows) == 1 and rows[0].role == "PREPARER"

    queue = await client.get("/api/v1/catalog-intake/queue", headers=bearer(assistant))
    assert queue.status_code == 200
    item = next(r for r in queue.json() if r["id"] == release_id)
    assert item["profile_name"] == "Shapla" and item["intake_mode"] == "ASSISTED" and item["preparer_count"] == 1
    _no_private_data(queue.text, email="intake-artist@example.com", user_id=artist_user["user"]["id"])


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_stay_in_their_workspace_and_out_of_private_areas(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label, platform = orgs["LABEL"], orgs["PLATFORM"]
    artist_user = await register_and_login(client, "intake-iso-artist@example.com")
    artist_id = await _artist_for(artist_user["user"]["id"], label, name="Isolated")
    elsewhere = await _staff_with(client, admin, "intake-elsewhere@example.com", "catalog_assistant", platform)

    # A21: an assistant working in another organization can't see or prepare this artist's music.
    assert (await client.post("/api/v1/studio/releases", headers=bearer(elsewhere), json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "x"})).status_code == 404
    assert all(c["id"] != artist_id for c in (await client.get("/api/v1/catalog-intake/profiles", headers=bearer(elsewhere))).json())
    own = await client.post("/api/v1/studio/releases", headers=bearer(artist_user["access_token"]), json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "Mine"})
    assert (await client.get(f"/api/v1/studio/releases/{own.json()['release']['id']}", headers=bearer(elsewhere))).status_code == 404

    # A20: catalog permissions open no account, user or application data.
    assistant = await _staff_with(client, admin, "intake-nosy@example.com", "catalog_assistant", label)
    assert (await client.get("/api/v1/users", headers=bearer(assistant))).status_code in (403, 404)
    assert (await client.get(f"/api/v1/users/{artist_user['user']['id']}", headers=bearer(assistant))).status_code in (403, 404)
    applications = await client.get("/api/v1/artist-applications", headers=bearer(assistant))
    # Without artist.manage, the list holds only the caller's own applications (none here).
    assert applications.status_code == 200 and applications.json()["items"] == []
    public_artist = await client.get(f"/api/v1/artists/{artist_id}", headers=bearer(assistant))
    assert SECRET_LEGAL_NAME not in public_artist.text
    assert "intake-iso-artist@example.com" not in public_artist.text

    # A plain signed-in user without catalog permissions gets nothing from the staff queue.
    fan = await register_and_login(client, "intake-fan@example.com")
    assert (await client.get("/api/v1/catalog-intake/queue", headers=bearer(fan["access_token"]))).status_code in (403, 409)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_managed_mode_needs_permission_and_reason(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    artist_user = await register_and_login(client, "intake-managed-artist@example.com")
    artist_id = await _artist_for(artist_user["user"]["id"], label, name="Managed Act")
    assistant = await _staff_with(client, admin, "intake-asst2@example.com", "catalog_assistant", label)
    manager = await _staff_with(client, admin, "intake-manager@example.com", "catalog_manager", label)
    release = (
        await client.post("/api/v1/studio/releases", headers=bearer(assistant), json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "EP", "title": "Special"})
    ).json()
    release_id = release["release"]["id"]

    # A22: managed mode needs music.intake_manage, and a written reason.
    no_perm = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/managed", headers=bearer(assistant), json={"enabled": True, "reason": "Artist is abroad and asked us to handle it"})
    assert no_perm.status_code == 403
    short = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/managed", headers=bearer(manager), json={"enabled": True, "reason": "busy"})
    assert short.status_code == 422
    on = await client.post(
        f"/api/v1/catalog-intake/releases/{release_id}/managed",
        headers=bearer(manager),
        json={"enabled": True, "reason": "Artist is abroad and asked Corner Room in writing to release it"},
    )
    assert on.status_code == 200 and on.json()["mode"] == "MANAGED"
    # Now staff may submit (the release still has to be complete).
    attempt = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(assistant), json={"rights_declaration": True})
    assert attempt.status_code == 409 and attempt.json()["code"] == "RELEASE_NOT_READY"
    # The artist sees why Corner Room manages it.
    seen = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(artist_user["access_token"]))).json()
    assert seen["intake"]["mode"] == "MANAGED" and "abroad" in seen["intake"]["managed_reason"]
    off = await client.post(f"/api/v1/catalog-intake/releases/{release_id}/managed", headers=bearer(manager), json={"enabled": False})
    assert off.status_code == 200 and off.json()["mode"] == "ASSISTED"
    again = await client.post(f"/api/v1/studio/releases/{release_id}/submit", headers=bearer(assistant), json={"rights_declaration": True})
    assert again.status_code == 403 and again.json()["code"] == "INTAKE_NOT_MANAGED"
