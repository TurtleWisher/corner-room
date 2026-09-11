"""Phase 04 events and venues. PostgreSQL tests skip honestly when the database is unavailable."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.outbox import OutboxEvent
from cornerroom.infra.settings import Settings
from cornerroom.kernel.events import EVENT_PLANNED, EVENT_PUBLISHED
from cornerroom.modules.audit.domain.models import AuditLog
from tests.auth_helpers import admin_token, bearer, register_and_login

FUTURE_START = datetime(2026, 12, 1, 18, 0, tzinfo=timezone.utc)
FUTURE_END = datetime(2026, 12, 1, 21, 0, tzinfo=timezone.utc)


async def _workspace(client: AsyncClient, token: str, org_id: str) -> str:
    switched = await client.post(f"/api/v1/organizations/{org_id}/switch", headers=bearer(token))
    assert switched.status_code == 200, switched.text
    return switched.json()["access_token"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase04_event_venue_isolation(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    label = next(row for row in orgs if row["type"] == "LABEL")
    admin_p = await _workspace(client, admin, platform["id"])

    created = await client.post(
        "/api/v1/events",
        headers=bearer(admin_p),
        json={
            "title": "Draft Night",
            "timezone": "UTC",
            "description": "Public copy for later publish",
            "starts_at": FUTURE_START.isoformat(),
            "ends_at": FUTURE_END.isoformat(),
        },
    )
    assert created.status_code == 201, created.text
    event = created.json()
    assert event["status"] == "DRAFT"
    assert event["organization_id"] == platform["id"]
    event_id = event["id"]

    anon = await client.get(f"/api/v1/events/{event_id}")
    assert anon.status_code == 404

    public_list = await client.get("/api/v1/events")
    assert public_list.status_code == 200
    assert all(row["id"] != event_id for row in public_list.json()["items"])

    naive = await client.post(
        "/api/v1/events",
        headers=bearer(admin_p),
        json={"title": "Naive", "timezone": "UTC", "starts_at": "2026-12-01T18:00:00"},
    )
    assert naive.status_code == 422

    dhaka_default = await client.post(
        "/api/v1/events",
        headers=bearer(admin_p),
        json={"title": "No tz"},
    )
    assert dhaka_default.status_code == 422

    inverted = await client.post(
        "/api/v1/events",
        headers=bearer(admin_p),
        json={
            "title": "Backwards",
            "timezone": "Europe/London",
            "starts_at": FUTURE_END.isoformat(),
            "ends_at": FUTURE_START.isoformat(),
        },
    )
    assert inverted.status_code == 422

    forged = await client.post(
        "/api/v1/events",
        headers=bearer(admin_p),
        json={"title": "Forged org", "timezone": "UTC", "organization_id": label["id"]},
    )
    assert forged.status_code == 403

    planned = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "plan"},
    )
    assert planned.status_code == 200
    assert planned.json()["status"] == "PLANNED"

    published = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "publish"},
    )
    assert published.status_code == 200
    assert published.json()["status"] == "PUBLISHED"

    guest = await client.get(f"/api/v1/events/{event_id}")
    assert guest.status_code == 200
    body = guest.json()
    assert "version" not in body
    assert body["title"] == "Draft Night"

    ticketing = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "open_ticketing"},
    )
    assert ticketing.status_code == 409
    assert ticketing.json()["code"] == "TICKETING_REQUIRED"

    skip = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "go_live"},
    )
    assert skip.status_code == 409

    postponed = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(admin_p),
        json={
            "action": "postpone",
            "starts_at": (FUTURE_START + timedelta(days=7)).isoformat(),
            "ends_at": (FUTURE_END + timedelta(days=7)).isoformat(),
            "reason": "Weather",
        },
    )
    assert postponed.status_code == 200
    assert postponed.json()["status"] == "POSTPONED"
    assert postponed.json()["previous_starts_at"] is not None

    resumed = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "resume", "resume_status": "PUBLISHED"},
    )
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "PUBLISHED"

    venue = await client.post(
        "/api/v1/venues",
        headers=bearer(admin_p),
        json={"name": "Hall One", "capacity": 200, "address": {"city": "Dhaka"}},
    )
    assert venue.status_code == 201
    assert venue.json()["status"] == "DRAFT"
    venue_id = venue.json()["id"]

    assign_draft = await client.post(
        f"/api/v1/events/{event_id}/venue",
        headers=bearer(admin_p),
        json={"venue_id": venue_id},
    )
    assert assign_draft.status_code == 409

    activated = await client.post(
        f"/api/v1/venues/{venue_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "activate"},
    )
    assert activated.status_code == 200
    assert activated.json()["status"] == "ACTIVE"

    assigned = await client.post(
        f"/api/v1/events/{event_id}/venue",
        headers=bearer(admin_p),
        json={"venue_id": venue_id},
    )
    assert assigned.status_code == 200
    assert assigned.json()["venue_id"] == venue_id

    stale = await client.patch(
        f"/api/v1/events/{event_id}",
        headers=bearer(admin_p),
        json={"title": "Stale write", "version": 1},
    )
    assert stale.status_code == 409

    patched = await client.patch(
        f"/api/v1/events/{event_id}",
        headers=bearer(admin_p),
        json={"title": "Renamed Night", "version": assigned.json()["version"]},
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "Renamed Night"

    cancelled = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "cancel", "reason": "Operational"},
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"

    staff = await register_and_login(client, "event-staff@example.com")
    roles = await client.get("/api/v1/roles", headers=bearer(admin_p))
    event_role = next(row for row in roles.json() if row["key"] == "event_manager")
    await client.post(
        f"/api/v1/organizations/{label['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": staff["user"]["id"], "status": "ACTIVE", "role_id": event_role["id"]},
    )
    token_label = await _workspace(client, staff["access_token"], label["id"])

    cross_get = await client.get(f"/api/v1/events/{event_id}", headers=bearer(token_label))
    assert cross_get.status_code == 404

    cross_patch = await client.patch(
        f"/api/v1/events/{event_id}",
        headers=bearer(token_label),
        json={"title": "Hijack"},
    )
    assert cross_patch.status_code == 404

    cross_life = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(token_label),
        json={"action": "cancel"},
    )
    assert cross_life.status_code == 404

    other_event = await client.post(
        "/api/v1/events",
        headers=bearer(token_label),
        json={"title": "Label Show", "timezone": "Asia/Tokyo", "starts_at": FUTURE_START.isoformat()},
    )
    assert other_event.status_code == 201
    assert other_event.json()["organization_id"] == label["id"]

    cross_venue = await client.post(
        f"/api/v1/events/{other_event.json()['id']}/venue",
        headers=bearer(token_label),
        json={"venue_id": venue_id},
    )
    assert cross_venue.status_code == 404

    missing = await client.get(f"/api/v1/events/{uuid4()}", headers=bearer(admin_p))
    assert missing.status_code == 404

    inactive = await client.post(
        f"/api/v1/venues/{venue_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "deactivate"},
    )
    assert inactive.status_code == 200
    reactivate = await client.post(
        f"/api/v1/venues/{venue_id}/lifecycle",
        headers=bearer(admin_p),
        json={"action": "activate"},
    )
    assert reactivate.status_code == 409

    settle = await client.post(
        f"/api/v1/events/{other_event.json()['id']}/lifecycle",
        headers=bearer(token_label),
        json={"action": "settle"},
    )
    assert settle.status_code == 409

    milestones = await client.get(f"/api/v1/events/{event_id}/milestones", headers=bearer(admin_p))
    assert milestones.status_code == 200
    types = {row["type"] for row in milestones.json()["items"]}
    assert "created" in types
    assert "published" in types
    assert "venue_confirmed" in types


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase04_audit_outbox_atomicity(pg_session: AsyncSession, settings: Settings) -> None:
    from cornerroom.infra.security import hash_password
    from cornerroom.infra.seed import seed_foundation
    from cornerroom.kernel.auth_context import AuthContext
    from cornerroom.modules.authorization.domain.models import Role, RoleAssignment
    from cornerroom.modules.events.application.service import EventService
    from cornerroom.modules.identity.domain.models import Organization, User

    await seed_foundation(pg_session, settings)
    role = (await pg_session.execute(select(Role).where(Role.key == "super_admin"))).scalar_one()
    admin = User(
        email="event-outbox@example.com",
        password_hash=hash_password("password12"),
        status="ACTIVE",
    )
    pg_session.add(admin)
    await pg_session.flush()
    pg_session.add(
        RoleAssignment(user_id=admin.id, role_id=role.id, organization_id=None, status="ACTIVE")
    )
    org = (
        await pg_session.execute(
            select(Organization).where(Organization.type == "PLATFORM", Organization.deleted_at.is_(None))
        )
    ).scalar_one()
    ctx = AuthContext(user_id=admin.id, request_id="phase04-outbox", organization_id=org.id)
    svc = EventService(pg_session)
    event = await svc.create_event(
        ctx,
        title="Outbox Night",
        timezone="UTC",
        description="Public copy",
        starts_at=FUTURE_START,
        ends_at=FUTURE_END,
    )
    event = await svc.transition_event(ctx, event.id, action="plan")
    event = await svc.transition_event(ctx, event.id, action="publish")
    planned = list(
        (
            await pg_session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == EVENT_PLANNED,
                    OutboxEvent.aggregate_id == event.id,
                )
            )
        ).scalars().all()
    )
    published = list(
        (
            await pg_session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == EVENT_PUBLISHED,
                    OutboxEvent.aggregate_id == event.id,
                )
            )
        ).scalars().all()
    )
    assert planned
    assert published
    audits = list(
        (
            await pg_session.execute(
                select(AuditLog).where(AuditLog.entity_id == str(event.id), AuditLog.action == "event.plan")
            )
        ).scalars().all()
    )
    assert audits

    await pg_session.rollback()
    svc2 = EventService(pg_session)
    await svc2.create_event(ctx, title="Rolled", timezone="UTC")
    await pg_session.rollback()
    leftover = (
        await pg_session.execute(select(OutboxEvent).where(OutboxEvent.correlation_id == "phase04-outbox"))
    ).scalar_one_or_none()
    assert leftover is None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase04_read_does_not_grant_lifecycle(client: AsyncClient) -> None:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    admin_p = await _workspace(client, admin, platform["id"])
    created = await client.post(
        "/api/v1/events",
        headers=bearer(admin_p),
        json={"title": "Read only", "timezone": "UTC", "starts_at": FUTURE_START.isoformat()},
    )
    event_id = created.json()["id"]
    fan = await register_and_login(client, "reader@example.com")
    await client.post(
        f"/api/v1/organizations/{platform['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": fan["user"]["id"], "status": "ACTIVE"},
    )
    token = await _workspace(client, fan["access_token"], platform["id"])
    seen = await client.get(f"/api/v1/events/{event_id}", headers=bearer(token))
    assert seen.status_code == 200
    denied = await client.post(
        f"/api/v1/events/{event_id}/lifecycle",
        headers=bearer(token),
        json={"action": "plan"},
    )
    assert denied.status_code == 403
