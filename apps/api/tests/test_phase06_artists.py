"""Phase 06 artists, bands, membership, lineup. PostgreSQL tests skip when unavailable."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.outbox import OutboxEvent
from cornerroom.infra.settings import Settings
from cornerroom.kernel.events import ARTIST_ACTIVATED, ARTIST_APPLICATION_SUBMITTED, BAND_MEMBER_CHANGED
from cornerroom.modules.audit.domain.models import AuditLog
from tests.auth_helpers import admin_token, bearer, register_and_login


async def _workspace(client: AsyncClient, token: str, org_id: str) -> str:
    switched = await client.post(f"/api/v1/organizations/{org_id}/switch", headers=bearer(token))
    assert switched.status_code == 200, switched.text
    return switched.json()["access_token"]


async def _activate_artist(client: AsyncClient, token: str, artist_id: str) -> dict:
    review = await client.post(
        f"/api/v1/artists/{artist_id}/lifecycle",
        headers=bearer(token),
        json={"action": "start_review"},
    )
    assert review.status_code == 200, review.text
    approved = await client.post(
        f"/api/v1/artists/{artist_id}/lifecycle",
        headers=bearer(token),
        json={"action": "approve", "version": review.json()["version"]},
    )
    assert approved.status_code == 200, approved.text
    active = await client.post(
        f"/api/v1/artists/{artist_id}/lifecycle",
        headers=bearer(token),
        json={"action": "activate", "version": approved.json()["version"]},
    )
    assert active.status_code == 200, active.text
    assert active.json()["status"] == "ACTIVE"
    return active.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase06_artist_band_isolation(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    label = next(row for row in orgs if row["type"] == "LABEL")
    admin_p = await _workspace(client, admin, platform["id"])

    created = await client.post(
        "/api/v1/artists",
        headers=bearer(admin_p),
        json={"stage_name": "Nila", "bio": "Roster artist", "metadata": {"genres": ["folk"]}},
    )
    assert created.status_code == 201, created.text
    artist = created.json()
    assert artist["status"] == "APPLIED"
    assert artist["primary_org_id"] == platform["id"]
    artist_id = artist["id"]

    anon = await client.get(f"/api/v1/artists/{artist_id}")
    assert anon.status_code == 404

    public_list = await client.get("/api/v1/artists")
    assert public_list.status_code == 200
    assert all(row["id"] != artist_id for row in public_list.json()["items"])

    forged = await client.post(
        "/api/v1/artists",
        headers=bearer(admin_p),
        json={"stage_name": "Forged", "organization_id": label["id"]},
    )
    assert forged.status_code == 403

    skip = await client.post(
        f"/api/v1/artists/{artist_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "activate"},
    )
    assert skip.status_code == 409

    activated = await _activate_artist(client, admin_p, artist_id)
    guest = await client.get(f"/api/v1/artists/{artist_id}")
    assert guest.status_code == 200
    assert guest.json()["stage_name"] == "Nila"
    assert "version" not in guest.json()

    stale = await client.patch(
        f"/api/v1/artists/{artist_id}",
        headers=bearer(admin_p),
        json={"stage_name": "Stale", "version": 1},
    )
    assert stale.status_code == 409

    patched = await client.patch(
        f"/api/v1/artists/{artist_id}",
        headers=bearer(admin_p),
        json={"stage_name": "Nila Two", "version": activated["version"]},
    )
    assert patched.status_code == 200
    assert patched.json()["stage_name"] == "Nila Two"

    unsuspend_prep = await client.post(
        f"/api/v1/artists/{artist_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "suspend", "version": patched.json()["version"]},
    )
    assert unsuspend_prep.status_code == 200
    unsuspend = await client.post(
        f"/api/v1/artists/{artist_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "activate", "version": unsuspend_prep.json()["version"]},
    )
    assert unsuspend.status_code == 409

    resume = await client.post(
        f"/api/v1/artists/{artist_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "start_review", "version": unsuspend_prep.json()["version"]},
    )
    assert resume.status_code == 409

    fan = await register_and_login(client, "artist-fan@example.com")
    follow = await client.post(f"/api/v1/artists/{artist_id}/follow", headers=bearer(fan["access_token"]))
    # Suspended artists are not public follow targets
    assert follow.status_code == 404

    unterminated = await client.post(
        f"/api/v1/artists/{artist_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "terminate", "version": unsuspend_prep.json()["version"]},
    )
    assert unterminated.status_code == 200

    band = await client.post(
        "/api/v1/bands",
        headers=bearer(admin_p),
        json={"name": "River Band"},
    )
    assert band.status_code == 201, band.text
    assert band.json()["status"] == "FORMING"
    assert band.json()["primary_org_id"] == platform["id"]
    band_id = band.json()["id"]

    member_user = await register_and_login(client, "band-member@example.com")
    invited = await client.post(
        f"/api/v1/bands/{band_id}/members",
        headers=bearer(admin_p),
        json={"user_id": member_user["user"]["id"], "role_label": "member"},
    )
    assert invited.status_code == 201, invited.text
    assert invited.json()["status"] == "INVITED"
    member_id = invited.json()["id"]

    other = await register_and_login(client, "not-member@example.com")
    hijack = await client.post(
        f"/api/v1/bands/{band_id}/members/{member_id}/lifecycle",
        headers=bearer(other["access_token"]),
        json={"action": "accept"},
    )
    assert hijack.status_code == 404

    accepted = await client.post(
        f"/api/v1/bands/{band_id}/members/{member_id}/lifecycle",
        headers=bearer(member_user["access_token"]),
        json={"action": "accept"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "ACTIVE"

    duplicate = await client.post(
        f"/api/v1/bands/{band_id}/members",
        headers=bearer(admin_p),
        json={"user_id": member_user["user"]["id"]},
    )
    assert duplicate.status_code in {201, 409}
    if duplicate.status_code == 201:
        second_accept = await client.post(
            f"/api/v1/bands/{band_id}/members/{duplicate.json()['id']}/lifecycle",
            headers=bearer(member_user["access_token"]),
            json={"action": "accept"},
        )
        assert second_accept.status_code == 409

    left = await client.post(
        f"/api/v1/bands/{band_id}/members/{member_id}/lifecycle",
        headers=bearer(member_user["access_token"]),
        json={"action": "leave"},
    )
    assert left.status_code == 200
    assert left.json()["status"] == "LEFT"

    activated_band = await client.post(
        f"/api/v1/bands/{band_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "activate", "version": band.json()["version"]},
    )
    assert activated_band.status_code == 200
    assert activated_band.json()["status"] == "ACTIVE"

    staff = await register_and_login(client, "label-staff@example.com")
    roles = await client.get("/api/v1/roles", headers=bearer(admin_p))
    label_role = next(row for row in roles.json() if row["key"] == "label_manager")
    await client.post(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": staff["user"]["id"], "status": "ACTIVE", "role_id": label_role["id"]},
    )
    token_label = await _workspace(client, staff["access_token"], label["id"])

    cross_get = await client.get(f"/api/v1/artists/{artist_id}", headers=bearer(token_label))
    assert cross_get.status_code == 404

    cross_patch = await client.patch(
        f"/api/v1/artists/{artist_id}",
        headers=bearer(token_label),
        json={"stage_name": "Hijack"},
    )
    assert cross_patch.status_code == 404

    label_artist = await client.post(
        "/api/v1/artists",
        headers=bearer(token_label),
        json={"stage_name": "Label Act"},
    )
    assert label_artist.status_code == 201
    assert label_artist.json()["primary_org_id"] == label["id"]

    applicant = await register_and_login(client, "applicant@example.com")
    application = await client.post(
        "/api/v1/artist-applications",
        headers=bearer(applicant["access_token"]),
        json={"stage_name": "New Voice", "bio": "Applicant"},
    )
    assert application.status_code == 201, application.text
    assert application.json()["status"] == "SUBMITTED"
    app_id = application.json()["id"]
    claimed_artist = application.json()["artist_id"]

    stranger = await register_and_login(client, "stranger@example.com")
    idor = await client.get(
        f"/api/v1/artists/{claimed_artist}",
        headers=bearer(stranger["access_token"]),
    )
    assert idor.status_code == 404
    idor_app = await client.get(
        f"/api/v1/artist-applications/{app_id}",
        headers=bearer(stranger["access_token"]),
    )
    assert idor_app.status_code == 404

    own = await client.get(
        f"/api/v1/artist-applications/{app_id}",
        headers=bearer(applicant["access_token"]),
    )
    assert own.status_code == 200

    withdrawn = await client.post(
        f"/api/v1/artist-applications/{app_id}/lifecycle",
        headers=bearer(applicant["access_token"]),
        json={"action": "withdraw"},
    )
    assert withdrawn.status_code == 200
    assert withdrawn.json()["status"] == "WITHDRAWN"

    reapply = await client.post(
        "/api/v1/artist-applications",
        headers=bearer(applicant["access_token"]),
        json={"stage_name": "New Voice 2"},
    )
    assert reapply.status_code == 409

    event = await client.post(
        "/api/v1/events",
        headers=bearer(admin_p),
        json={"title": "Lineup Night", "timezone": "UTC"},
    )
    assert event.status_code == 201
    event_id = event.json()["id"]

    # Need an ACTIVE artist for lineup. Create a fresh one.
    live_artist = await client.post(
        "/api/v1/artists",
        headers=bearer(admin_p),
        json={"stage_name": "Live Act"},
    )
    live = await _activate_artist(client, admin_p, live_artist.json()["id"])
    lineup = await client.post(
        f"/api/v1/events/{event_id}/lineup",
        headers=bearer(admin_p),
        json={"artist_id": live["id"], "billing_order": 1},
    )
    assert lineup.status_code == 201, lineup.text
    assert lineup.json()["status"] == "INVITED"
    assert lineup.json()["contract_id"] is None

    both = await client.post(
        f"/api/v1/events/{event_id}/lineup",
        headers=bearer(admin_p),
        json={"artist_id": live["id"], "band_id": band_id},
    )
    assert both.status_code == 422

    confirmed = await client.post(
        f"/api/v1/events/{event_id}/lineup/{lineup.json()['id']}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "confirm", "version": lineup.json()["version"]},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "CONFIRMED"

    missing = await client.get(f"/api/v1/artists/{uuid4()}", headers=bearer(admin_p))
    assert missing.status_code == 404


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase06_audit_outbox_atomicity(pg_session: AsyncSession, settings: Settings) -> None:
    from cornerroom.infra.security import hash_password
    from cornerroom.infra.seed import seed_foundation
    from cornerroom.kernel.auth_context import AuthContext
    from cornerroom.modules.artists.application.service import ArtistService
    from cornerroom.modules.authorization.domain.models import Role, RoleAssignment
    from cornerroom.modules.identity.domain.models import Organization, User

    await seed_foundation(pg_session, settings)
    role = (await pg_session.execute(select(Role).where(Role.key == "super_admin"))).scalar_one()
    admin = User(
        email="artist-outbox@example.com",
        password_hash=hash_password("password12"),
        status="ACTIVE",
    )
    pg_session.add(admin)
    await pg_session.flush()
    pg_session.add(RoleAssignment(user_id=admin.id, role_id=role.id, organization_id=None, status="ACTIVE"))
    org = (
        await pg_session.execute(
            select(Organization).where(Organization.type == "LABEL", Organization.deleted_at.is_(None))
        )
    ).scalar_one()
    ctx = AuthContext(user_id=admin.id, request_id="phase06-outbox", organization_id=org.id)
    svc = ArtistService(pg_session)
    artist = await svc.create_artist(ctx, stage_name="Outbox Voice")
    artist = await svc.transition_artist(ctx, artist.id, action="start_review")
    artist = await svc.transition_artist(ctx, artist.id, action="approve")
    artist = await svc.transition_artist(ctx, artist.id, action="activate")
    activated = list(
        (
            await pg_session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == ARTIST_ACTIVATED,
                    OutboxEvent.aggregate_id == artist.id,
                )
            )
        ).scalars().all()
    )
    assert activated
    audits = list(
        (
            await pg_session.execute(
                select(AuditLog).where(AuditLog.entity_id == str(artist.id), AuditLog.action == "artist.activate")
            )
        ).scalars().all()
    )
    assert audits

    applicant = User(
        email="apply-outbox@example.com",
        password_hash=hash_password("password12"),
        status="ACTIVE",
    )
    pg_session.add(applicant)
    await pg_session.flush()
    app_ctx = AuthContext(user_id=applicant.id, request_id="phase06-apply")
    application, _created = await svc.submit_application(app_ctx, stage_name="Applicant Voice")
    submitted = list(
        (
            await pg_session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == ARTIST_APPLICATION_SUBMITTED,
                    OutboxEvent.aggregate_id == application.id,
                )
            )
        ).scalars().all()
    )
    assert submitted

    band = await svc.create_band(ctx, name="Outbox Band")
    member_user = User(
        email="member-outbox@example.com",
        password_hash=hash_password("password12"),
        status="ACTIVE",
    )
    pg_session.add(member_user)
    await pg_session.flush()
    await svc.invite_member(ctx, band.id, user_id=member_user.id)
    changed = list(
        (
            await pg_session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == BAND_MEMBER_CHANGED,
                    OutboxEvent.aggregate_id == band.id,
                )
            )
        ).scalars().all()
    )
    assert changed

    await pg_session.rollback()
    leftover = (
        await pg_session.execute(select(OutboxEvent).where(OutboxEvent.correlation_id == "phase06-outbox"))
    ).scalar_one_or_none()
    assert leftover is None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase06_concurrency_version(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    token = await _workspace(client, admin, platform["id"])
    created = await client.post(
        "/api/v1/artists",
        headers=bearer(token),
        json={"stage_name": "Concurrent"},
    )
    assert created.status_code == 201
    version = created.json()["version"]
    artist_id = created.json()["id"]
    first = await client.patch(
        f"/api/v1/artists/{artist_id}",
        headers=bearer(token),
        json={"bio": "one", "version": version},
    )
    assert first.status_code == 200
    second = await client.patch(
        f"/api/v1/artists/{artist_id}",
        headers=bearer(token),
        json={"bio": "two", "version": version},
    )
    assert second.status_code == 409
