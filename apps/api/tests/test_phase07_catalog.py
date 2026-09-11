"""Phase 07 catalog. PostgreSQL tests skip when unavailable."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.outbox import OutboxEvent
from cornerroom.infra.settings import Settings
from cornerroom.kernel.events import (
    METADATA_CORRECTED,
    RELEASE_RELEASED,
    TRACK_CREATED,
    TRACK_RELEASED,
)
from cornerroom.modules.audit.domain.models import AuditLog
from cornerroom.modules.documents.domain.models import MediaAsset
from tests.auth_helpers import admin_token, bearer, register_and_login


async def _workspace(client: AsyncClient, token: str, org_id: str) -> str:
    switched = await client.post(f"/api/v1/organizations/{org_id}/switch", headers=bearer(token))
    assert switched.status_code == 200, switched.text
    return switched.json()["access_token"]


async def _ready_version(client: AsyncClient, token: str, track_id: str) -> dict:
    created = await client.post(
        f"/api/v1/tracks/{track_id}/versions",
        headers=bearer(token),
        json={"version_type": "MASTER"},
    )
    assert created.status_code == 201, created.text
    ready = await client.post(
        f"/api/v1/tracks/{track_id}/versions/{created.json()['id']}/transition",
        headers=bearer(token),
        json={"action": "mark_ready", "version": created.json()["version"]},
    )
    assert ready.status_code == 200, ready.text
    assert ready.json()["status"] == "READY"
    assert ready.json()["media_asset_id"] is None
    return ready.json()


async def _release_track(client: AsyncClient, token: str, track_id: str, version: int) -> dict:
    submit = await client.post(
        f"/api/v1/tracks/{track_id}/transition",
        headers=bearer(token),
        json={"action": "submit", "version": version},
    )
    assert submit.status_code == 200, submit.text
    review = await client.post(
        f"/api/v1/tracks/{track_id}/transition",
        headers=bearer(token),
        json={"action": "start_review", "version": submit.json()["version"]},
    )
    assert review.status_code == 200, review.text
    approved = await client.post(
        f"/api/v1/tracks/{track_id}/transition",
        headers=bearer(token),
        json={"action": "approve", "version": review.json()["version"]},
    )
    assert approved.status_code == 200, approved.text
    released = await client.post(
        f"/api/v1/tracks/{track_id}/transition",
        headers=bearer(token),
        json={"action": "release", "version": approved.json()["version"]},
    )
    assert released.status_code == 200, released.text
    assert released.json()["status"] == "RELEASED"
    return released.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase07_catalog_crud_lifecycle_idor(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    label = next(row for row in orgs if row["type"] == "LABEL")
    admin_p = await _workspace(client, admin, platform["id"])

    artist = await client.post(
        "/api/v1/artists",
        headers=bearer(admin_p),
        json={"stage_name": "Catalog Voice"},
    )
    assert artist.status_code == 201, artist.text
    artist_id = artist.json()["id"]

    created = await client.post(
        "/api/v1/tracks",
        headers=bearer(admin_p),
        json={"title": "River", "primary_artist_id": artist_id, "metadata": {"genres": ["folk"]}},
    )
    assert created.status_code == 201, created.text
    track = created.json()
    assert track["status"] == "DRAFT"
    assert track["primary_org_id"] == platform["id"]
    assert track["isrc"] is None
    track_id = track["id"]

    anon = await client.get(f"/api/v1/tracks/{track_id}")
    assert anon.status_code == 404

    public_list = await client.get("/api/v1/tracks")
    assert public_list.status_code == 200
    assert all(row["id"] != track_id for row in public_list.json()["items"])

    forged = await client.post(
        "/api/v1/tracks",
        headers=bearer(admin_p),
        json={"title": "Forged", "organization_id": label["id"]},
    )
    assert forged.status_code == 403

    skip = await client.post(
        f"/api/v1/tracks/{track_id}/transition",
        headers=bearer(admin_p),
        json={"action": "release"},
    )
    assert skip.status_code == 409

    await _ready_version(client, admin_p, track_id)
    released = await _release_track(client, admin_p, track_id, created.json()["version"])
    guest = await client.get(f"/api/v1/tracks/{track_id}")
    assert guest.status_code == 200
    assert guest.json()["title"] == "River"
    assert "version" not in guest.json()

    fan = await register_and_login(client, "catalog-fan@example.com")
    idor_patch = await client.patch(
        f"/api/v1/tracks/{track_id}",
        headers=bearer(fan["access_token"]),
        json={"title": "Stolen", "version": released["version"]},
    )
    assert idor_patch.status_code == 404

    restore = await client.post(
        f"/api/v1/tracks/{track_id}/transition",
        headers=bearer(admin_p),
        json={"action": "takedown", "version": released["version"]},
    )
    assert restore.status_code == 200
    hidden = await client.get(f"/api/v1/tracks/{track_id}")
    assert hidden.status_code == 404
    un_restore = await client.post(
        f"/api/v1/tracks/{track_id}/transition",
        headers=bearer(admin_p),
        json={"action": "release", "version": restore.json()["version"]},
    )
    assert un_restore.status_code == 409

    album = await client.post(
        "/api/v1/releases",
        headers=bearer(admin_p),
        json={"title": "River LP", "release_type": "ALBUM", "primary_artist_id": artist_id},
    )
    assert album.status_code == 201, album.text
    assert album.json()["status"] == "IDEA"
    assert album.json()["release_type"] == "ALBUM"
    release_id = album.json()["id"]

    both_party = await client.post(
        "/api/v1/releases",
        headers=bearer(admin_p),
        json={
            "title": "Both",
            "release_type": "SINGLE",
            "primary_artist_id": artist_id,
            "primary_band_id": str(uuid4()),
        },
    )
    assert both_party.status_code == 422

    draft_track = await client.post(
        "/api/v1/tracks",
        headers=bearer(admin_p),
        json={"title": "Unreleased Cut"},
    )
    assert draft_track.status_code == 201
    linked = await client.post(
        f"/api/v1/releases/{release_id}/tracks",
        headers=bearer(admin_p),
        json={"track_id": draft_track.json()["id"], "position": 1},
    )
    assert linked.status_code == 201, linked.text
    dup_pos = await client.post(
        f"/api/v1/releases/{release_id}/tracks",
        headers=bearer(admin_p),
        json={"track_id": track_id, "position": 1},
    )
    assert dup_pos.status_code == 409
    second = await client.post(
        f"/api/v1/releases/{release_id}/tracks",
        headers=bearer(admin_p),
        json={"track_id": track_id, "position": 2},
    )
    assert second.status_code == 201

    credit = await client.post(
        f"/api/v1/tracks/{draft_track.json()['id']}/credits",
        headers=bearer(admin_p),
        json={"artist_id": artist_id, "credit_role": "performer"},
    )
    assert credit.status_code == 201, credit.text
    assert credit.json()["credit_role"] == "performer"

    approve_release = await client.post(
        f"/api/v1/releases/{release_id}/transition",
        headers=bearer(admin_p),
        json={"action": "approve", "version": album.json()["version"]},
    )
    assert approve_release.status_code == 200
    published = await client.post(
        f"/api/v1/releases/{release_id}/transition",
        headers=bearer(admin_p),
        json={"action": "release", "version": approve_release.json()["version"]},
    )
    assert published.status_code == 200
    assert published.json()["status"] == "RELEASED"
    child = await client.get(f"/api/v1/tracks/{draft_track.json()['id']}", headers=bearer(admin_p))
    assert child.json()["status"] == "DRAFT"

    guest_release = await client.get(f"/api/v1/releases/{release_id}")
    assert guest_release.status_code == 200
    assert "version" not in guest_release.json()

    admin_l = await _workspace(client, admin, label["id"])
    cross = await client.get(f"/api/v1/releases/{release_id}", headers=bearer(admin_l))
    # Super admin is unscoped, so still visible; isolation is for org-scoped staff.
    assert cross.status_code == 200

    stale = await client.patch(
        f"/api/v1/releases/{release_id}",
        headers=bearer(admin_p),
        json={"title": "Stale", "version": 1},
    )
    assert stale.status_code == 409


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase07_media_gate(pg_session: AsyncSession, settings: Settings) -> None:
    from cornerroom.infra.errors import AppError
    from cornerroom.infra.security import hash_password
    from cornerroom.infra.seed import seed_foundation
    from cornerroom.kernel.auth_context import AuthContext
    from cornerroom.modules.authorization.domain.models import Role, RoleAssignment
    from cornerroom.modules.identity.domain.models import Organization, User
    from cornerroom.modules.music.application.service import MusicService

    await seed_foundation(pg_session, settings)
    role = (await pg_session.execute(select(Role).where(Role.key == "super_admin"))).scalar_one()
    admin = User(
        email="catalog-media@example.com",
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
    audio = MediaAsset(
        storage_class="catalog_audio",
        bucket="local",
        object_key="catalog_audio/gate/master.bin",
        mime="audio/mpeg",
        byte_size=12,
        sha256="a" * 64,
        status="READY",
        scan_status="SKIPPED_LOCAL",
    )
    public = MediaAsset(
        storage_class="public_media",
        bucket="local",
        object_key="public_media/gate/cover.png",
        mime="image/png",
        byte_size=8,
        sha256="b" * 64,
        status="READY",
        scan_status="SKIPPED_LOCAL",
    )
    pg_session.add_all([audio, public])
    await pg_session.flush()
    ctx = AuthContext(user_id=admin.id, request_id="phase07-media", organization_id=org.id)
    svc = MusicService(pg_session, settings=settings)
    with pytest.raises(AppError) as cover_exc:
        await svc.create_release(
            ctx, title="Cover Gate", release_type="SINGLE", cover_asset_id=audio.id
        )
    assert cover_exc.value.code == "RESIDENCY_GATE"
    track = await svc.create_track(ctx, title="Audio Gate")
    with pytest.raises(AppError) as audio_exc:
        await svc.create_version(ctx, track.id, media_asset_id=public.id)
    assert audio_exc.value.status == 422
    ok = await svc.create_release(
        ctx, title="Cover OK", release_type="SINGLE", cover_asset_id=public.id
    )
    assert ok.cover_asset_id == public.id
    nullable = await svc.create_version(ctx, track.id)
    assert nullable.media_asset_id is None
    assert nullable.status == "UPLOADING"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase07_audit_outbox_atomicity(pg_session: AsyncSession, settings: Settings) -> None:
    from cornerroom.infra.security import hash_password
    from cornerroom.infra.seed import seed_foundation
    from cornerroom.kernel.auth_context import AuthContext
    from cornerroom.modules.authorization.domain.models import Role, RoleAssignment
    from cornerroom.modules.identity.domain.models import Organization, User
    from cornerroom.modules.music.application.service import MusicService

    await seed_foundation(pg_session, settings)
    role = (await pg_session.execute(select(Role).where(Role.key == "super_admin"))).scalar_one()
    admin = User(
        email="catalog-outbox@example.com",
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
    ctx = AuthContext(user_id=admin.id, request_id="phase07-outbox", organization_id=org.id)
    svc = MusicService(pg_session, settings=settings)
    track = await svc.create_track(ctx, title="Outbox Track")
    created = list(
        (
            await pg_session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == TRACK_CREATED,
                    OutboxEvent.aggregate_id == track.id,
                )
            )
        ).scalars().all()
    )
    assert created
    version = await svc.create_version(ctx, track.id)
    await svc.transition_version(ctx, track.id, version.id, action="mark_ready")
    track = await svc.transition_track(ctx, track.id, action="submit")
    track = await svc.transition_track(ctx, track.id, action="start_review")
    track = await svc.transition_track(ctx, track.id, action="approve")
    track = await svc.transition_track(ctx, track.id, action="release")
    released = list(
        (
            await pg_session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == TRACK_RELEASED,
                    OutboxEvent.aggregate_id == track.id,
                )
            )
        ).scalars().all()
    )
    assert released
    audits = list(
        (
            await pg_session.execute(
                select(AuditLog).where(AuditLog.entity_id == str(track.id), AuditLog.action == "track.release")
            )
        ).scalars().all()
    )
    assert audits

    release = await svc.create_release(ctx, title="Outbox Single", release_type="SINGLE")
    release = await svc.update_release(ctx, release.id, title="Outbox Single Two")
    meta = list(
        (
            await pg_session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == METADATA_CORRECTED,
                    OutboxEvent.aggregate_id == release.id,
                )
            )
        ).scalars().all()
    )
    assert meta
    release = await svc.transition_release(ctx, release.id, action="approve")
    release = await svc.transition_release(ctx, release.id, action="release")
    published = list(
        (
            await pg_session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == RELEASE_RELEASED,
                    OutboxEvent.aggregate_id == release.id,
                )
            )
        ).scalars().all()
    )
    assert published

    await pg_session.rollback()
    leftover = (
        await pg_session.execute(select(OutboxEvent).where(OutboxEvent.correlation_id == "phase07-outbox"))
    ).scalar_one_or_none()
    assert leftover is None
