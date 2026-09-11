"""Phase 12 marketing campaigns. PostgreSQL tests skip honestly when unavailable."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.outbox import OutboxEvent
from cornerroom.kernel.events import CAMPAIGN_COMPLETED, CAMPAIGN_STARTED, CAMPAIGN_TASK_ASSIGNED
from cornerroom.modules.audit.domain.models import AuditLog
from cornerroom.modules.finance.domain.models import LedgerEntry
from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase07_catalog import _workspace


async def _platform_admin(client: AsyncClient) -> tuple[str, str, dict]:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    label = next(row for row in orgs if row["type"] == "LABEL")
    token = await _workspace(client, admin, platform["id"])
    return token, platform["id"], label


async def _assign_marketing(client: AsyncClient, staff_token: str, user_id: str, org_id: str) -> str:
    roles = (await client.get("/api/v1/roles", headers=bearer(staff_token))).json()
    role = next(row for row in roles if row["key"] == "marketing_manager")
    assigned = await client.post(
        f"/api/v1/users/{user_id}/assignments",
        headers=bearer(staff_token),
        json={"role_id": role["id"], "organization_id": org_id},
    )
    assert assigned.status_code == 201, assigned.text
    return role["id"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase12_campaigns_authz_links_budget_finance_media(client: AsyncClient) -> None:
    staff, org_id, label = await _platform_admin(client)
    marketer = await register_and_login(client, "marketer-p12@example.com")
    stranger = await register_and_login(client, "stranger-p12@example.com")
    await _assign_marketing(client, staff, marketer["user"]["id"], org_id)
    marketer_token = await _workspace(client, marketer["access_token"], org_id)

    anon = await client.get("/api/v1/campaigns")
    assert anon.status_code == 401

    hidden = await client.get("/api/v1/campaigns", headers=bearer(stranger["access_token"]))
    assert hidden.status_code in {403, 404, 409}

    created = await client.post(
        "/api/v1/campaigns",
        headers=bearer(marketer_token),
        json={"title": "Release week"},
    )
    assert created.status_code == 201, created.text
    campaign = created.json()
    assert campaign["status"] == "PLANNING"
    assert campaign["budget"] is None
    assert campaign["attribution_status"] == "ATTRIBUTION_UNDEFINED"
    campaign_id = campaign["id"]

    listed = await client.get("/api/v1/campaigns", headers=bearer(marketer_token))
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == campaign_id for row in listed.json()["items"])

    pause = await client.post(
        f"/api/v1/campaigns/{campaign_id}/transition",
        headers=bearer(marketer_token),
        json={"action": "pause"},
    )
    assert pause.status_code == 422

    skip = await client.post(
        f"/api/v1/campaigns/{campaign_id}/transition",
        headers=bearer(marketer_token),
        json={"action": "activate"},
    )
    assert skip.status_code == 409

    spend_null = await client.post(
        f"/api/v1/campaigns/{campaign_id}/expense-requests",
        headers=bearer(marketer_token),
        json={"category": "ADS", "amount": {"amount_minor": 500, "currency_code": "BDT"}},
    )
    assert spend_null.status_code == 409
    assert spend_null.json()["code"] == "BUDGET_REQUIRED"

    patched = await client.patch(
        f"/api/v1/campaigns/{campaign_id}",
        headers=bearer(marketer_token),
        json={
            "budget": {"amount_minor": 1000, "currency_code": "BDT"},
            "version": campaign["version"],
        },
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["budget"] == {"amount_minor": 1000, "currency_code": "BDT"}

    stale = await client.patch(
        f"/api/v1/campaigns/{campaign_id}",
        headers=bearer(marketer_token),
        json={"title": "Stale", "version": 1},
    )
    assert stale.status_code == 409

    over = await client.post(
        f"/api/v1/campaigns/{campaign_id}/expense-requests",
        headers=bearer(marketer_token),
        json={"category": "ADS", "amount": {"amount_minor": 1001, "currency_code": "BDT"}},
    )
    assert over.status_code == 409
    assert over.json()["code"] == "BUDGET_CAP_EXCEEDED"

    missing_cat = await client.post(
        f"/api/v1/campaigns/{campaign_id}/expense-requests",
        headers=bearer(marketer_token),
        json={"category": "ADS", "amount": {"amount_minor": 400, "currency_code": "BDT"}},
    )
    assert missing_cat.status_code == 409
    assert missing_cat.json()["code"] == "EXPENSE_CATEGORY_REQUIRED"

    category = await client.post(
        "/api/v1/expense-categories",
        headers=bearer(staff),
        json={"code": "ADS", "name": "Campaign media"},
    )
    assert category.status_code == 201, category.text

    request = await client.post(
        f"/api/v1/campaigns/{campaign_id}/expense-requests",
        headers=bearer(marketer_token),
        json={"category": "ADS", "amount": {"amount_minor": 400, "currency_code": "BDT"}},
    )
    assert request.status_code == 201, request.text
    assert request.json()["status"] == "DRAFT"
    assert request.json()["campaign_id"] == campaign_id
    expense_id = request.json()["id"]

    campaign_uuid = UUID(campaign_id)
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        ledgers = (
            await session.execute(select(LedgerEntry).where(LedgerEntry.campaign_id == campaign_uuid))
        ).scalars().all()
        assert ledgers == []
        audits = (
            await session.execute(
                select(AuditLog).where(
                    AuditLog.entity_type == "Campaign",
                    AuditLog.entity_id == campaign_id,
                )
            )
        ).scalars().all()
        assert any(row.action == "campaign.created" for row in audits)

    recognize_as_marketer = await client.post(
        f"/api/v1/expenses/{expense_id}/recognize",
        headers=bearer(marketer_token),
    )
    assert recognize_as_marketer.status_code in {403, 404, 409}

    approved = await client.post(
        f"/api/v1/expenses/{expense_id}/approve",
        headers=bearer(staff),
    )
    assert approved.status_code == 200, approved.text
    recognized = await client.post(
        f"/api/v1/expenses/{expense_id}/recognize",
        headers=bearer(staff),
    )
    assert recognized.status_code == 200, recognized.text
    assert recognized.json()["status"] == "RECOGNIZED"

    async with factory() as session:
        ledgers = (
            await session.execute(select(LedgerEntry).where(LedgerEntry.campaign_id == campaign_uuid))
        ).scalars().all()
        assert ledgers
        assert all(row.campaign_id is not None for row in ledgers)

    remaining_over = await client.post(
        f"/api/v1/campaigns/{campaign_id}/expense-requests",
        headers=bearer(marketer_token),
        json={"category": "ADS", "amount": {"amount_minor": 700, "currency_code": "BDT"}},
    )
    assert remaining_over.status_code == 409

    artist = await client.post(
        "/api/v1/artists",
        headers=bearer(staff),
        json={"stage_name": "Campaign Artist"},
    )
    assert artist.status_code == 201, artist.text
    linked = await client.post(
        f"/api/v1/campaigns/{campaign_id}/links",
        headers=bearer(marketer_token),
        json={"subject_type": "ARTIST", "subject_id": artist.json()["id"]},
    )
    assert linked.status_code == 201, linked.text

    band_type = await client.post(
        f"/api/v1/campaigns/{campaign_id}/links",
        headers=bearer(marketer_token),
        json={"subject_type": "BAND", "subject_id": str(uuid4())},
    )
    assert band_type.status_code == 409
    assert band_type.json()["code"] == "INVALID_SUBJECT_TYPE"

    album_type = await client.post(
        f"/api/v1/campaigns/{campaign_id}/links",
        headers=bearer(marketer_token),
        json={"subject_type": "ALBUM", "subject_id": str(uuid4())},
    )
    assert album_type.status_code == 409

    admin_label = await _workspace(client, staff, label["id"])
    other_artist = await client.post(
        "/api/v1/artists",
        headers=bearer(admin_label),
        json={"stage_name": "Other Org Artist"},
    )
    assert other_artist.status_code == 201, other_artist.text
    cross = await client.post(
        f"/api/v1/campaigns/{campaign_id}/links",
        headers=bearer(marketer_token),
        json={"subject_type": "ARTIST", "subject_id": other_artist.json()["id"]},
    )
    assert cross.status_code == 409
    assert cross.json()["code"] == "SUBJECT_ORG_MISMATCH"

    session_pub = await client.post(
        "/api/v1/uploads/sessions",
        headers=bearer(marketer_token),
        json={"storage_class": "public_media", "filename": "cover.png", "mime": "image/png"},
    )
    assert session_pub.status_code == 201, session_pub.text
    complete_pub = await client.post(
        f"/api/v1/uploads/{session_pub.json()['id']}/complete",
        headers=bearer(marketer_token),
        files={"file": ("cover.png", b"png-bytes", "image/png")},
    )
    assert complete_pub.status_code == 200, complete_pub.text
    bad_asset = await client.post(
        f"/api/v1/campaigns/{campaign_id}/assets",
        headers=bearer(marketer_token),
        json={"media_asset_id": complete_pub.json()["id"]},
    )
    assert bad_asset.status_code == 409
    assert bad_asset.json()["code"] == "INVALID_STORAGE_CLASS"

    session_ok = await client.post(
        "/api/v1/uploads/sessions",
        headers=bearer(marketer_token),
        json={"storage_class": "campaign_asset", "filename": "banner.jpg", "mime": "image/jpeg"},
    )
    assert session_ok.status_code == 201, session_ok.text
    complete_ok = await client.post(
        f"/api/v1/uploads/{session_ok.json()['id']}/complete",
        headers=bearer(marketer_token),
        files={"file": ("banner.jpg", b"jpg-bytes", "image/jpeg")},
    )
    assert complete_ok.status_code == 200, complete_ok.text
    good_asset = await client.post(
        f"/api/v1/campaigns/{campaign_id}/assets",
        headers=bearer(marketer_token),
        json={"media_asset_id": complete_ok.json()["id"]},
    )
    assert good_asset.status_code == 201, good_asset.text

    channel = await client.post(
        f"/api/v1/campaigns/{campaign_id}/channels",
        headers=bearer(marketer_token),
        json={"code": "EMAIL"},
    )
    assert channel.status_code == 201, channel.text
    vendor = await client.post(
        f"/api/v1/campaigns/{campaign_id}/channels",
        headers=bearer(marketer_token),
        json={"code": "FACEBOOK"},
    )
    assert vendor.status_code == 409

    kpi = await client.post(
        f"/api/v1/campaigns/{campaign_id}/kpi-targets",
        headers=bearer(marketer_token),
        json={"metric_key": "streams", "target_value": 10000},
    )
    assert kpi.status_code == 201, kpi.text
    assert kpi.json()["attribution_status"] == "ATTRIBUTION_UNDEFINED"

    task = await client.post(
        f"/api/v1/campaigns/{campaign_id}/tasks",
        headers=bearer(marketer_token),
        json={"title": "Write copy", "assignee_user_id": marketer["user"]["id"]},
    )
    assert task.status_code == 201, task.text
    assert task.json()["status"] == "TODO"
    task_id = task.json()["id"]
    too_soon = await client.post(
        f"/api/v1/campaigns/{campaign_id}/tasks/{task_id}/complete",
        headers=bearer(marketer_token),
    )
    assert too_soon.status_code == 409
    started = await client.post(
        f"/api/v1/campaigns/{campaign_id}/tasks/{task_id}/transition",
        headers=bearer(marketer_token),
        json={"action": "start", "version": task.json()["version"]},
    )
    assert started.status_code == 200, started.text
    done = await client.post(
        f"/api/v1/campaigns/{campaign_id}/tasks/{task_id}/complete",
        headers=bearer(marketer_token),
        params={"version": started.json()["version"]},
    )
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "DONE"

    for action in ("prepare_content", "schedule", "activate"):
        moved = await client.post(
            f"/api/v1/campaigns/{campaign_id}/transition",
            headers=bearer(marketer_token),
            json={"action": action},
        )
        assert moved.status_code == 200, moved.text
    assert moved.json()["status"] == "ACTIVE"

    async with factory() as session:
        started_events = (
            await session.execute(select(OutboxEvent).where(OutboxEvent.event_type == CAMPAIGN_STARTED))
        ).scalars().all()
        assert any(row.aggregate_id == campaign_uuid for row in started_events)
        assigned_events = (
            await session.execute(
                select(OutboxEvent).where(OutboxEvent.event_type == CAMPAIGN_TASK_ASSIGNED)
            )
        ).scalars().all()
        assert assigned_events
        audits = (
            await session.execute(
                select(AuditLog).where(
                    AuditLog.entity_type == "Campaign",
                    AuditLog.entity_id == campaign_id,
                    AuditLog.action == "campaign.activate",
                )
            )
        ).scalars().all()
        assert audits

    for action in ("optimize", "complete"):
        moved = await client.post(
            f"/api/v1/campaigns/{campaign_id}/transition",
            headers=bearer(marketer_token),
            json={"action": action},
        )
        assert moved.status_code == 200, moved.text
    assert moved.json()["status"] == "COMPLETED"

    cancel_done = await client.post(
        f"/api/v1/campaigns/{campaign_id}/transition",
        headers=bearer(marketer_token),
        json={"action": "cancel"},
    )
    assert cancel_done.status_code == 409

    async with factory() as session:
        completed_events = (
            await session.execute(select(OutboxEvent).where(OutboxEvent.event_type == CAMPAIGN_COMPLETED))
        ).scalars().all()
        assert any(row.aggregate_id == campaign_uuid for row in completed_events)

    other = await register_and_login(client, "label-marketer-p12@example.com")
    await _assign_marketing(client, staff, other["user"]["id"], label["id"])
    other_token = await _workspace(client, other["access_token"], label["id"])
    idor = await client.get(f"/api/v1/campaigns/{campaign_id}", headers=bearer(other_token))
    assert idor.status_code == 404
    idor_patch = await client.patch(
        f"/api/v1/campaigns/{campaign_id}",
        headers=bearer(other_token),
        json={"title": "Hijack"},
    )
    assert idor_patch.status_code == 404
