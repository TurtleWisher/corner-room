"""Phase 13 HTTP contract: event-driven notify, workspace, IDOR, finance isolation."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.modules.notifications.domain.models import Notification
from cornerroom.worker import drain_outbox
from tests.auth_helpers import bearer, register_and_login
from tests.test_phase07_catalog import _workspace
from tests.test_phase13_api import _assign_role, _platform_admin


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_http_notification_e2e_and_idor(client: AsyncClient) -> None:
    owner = await register_and_login(
        client, "qa.p13.notify.a@example.com", display_name="QA_USER_A"
    )
    stranger = await register_and_login(
        client, "qa.p13.notify.b@example.com", display_name="QA_USER_B"
    )
    published = await drain_outbox({})
    assert published >= 1

    listed = await client.get("/api/v1/me/notifications", headers=bearer(owner["access_token"]))
    assert listed.status_code == 200, listed.text
    items = listed.json()
    assert isinstance(items, list)
    assert items, "expected UserRegistered notification via outbox"
    note = next(row for row in items if row["type"] == "user.registered")
    note_id = note["id"]
    assert note["status"] == "UNREAD"
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        row = await session.get(Notification, UUID(note_id))
        assert row is not None
        assert row.consumer == "notifications"
        assert row.source_event_id is not None

    hidden = await client.get("/api/v1/me/notifications", headers=bearer(stranger["access_token"]))
    assert hidden.status_code == 200
    assert all(row["id"] != note_id for row in hidden.json())

    stolen = await client.post(
        f"/api/v1/me/notifications/{note_id}/read",
        headers=bearer(stranger["access_token"]),
    )
    assert stolen.status_code == 404
    assert stolen.headers["content-type"].startswith("application/problem+json")
    assert stolen.json()["correlation_id"]

    first = await client.post(
        f"/api/v1/me/notifications/{note_id}/read",
        headers=bearer(owner["access_token"]),
    )
    assert first.status_code == 200
    read_at = first.json()["read_at"]
    second = await client.post(
        f"/api/v1/me/notifications/{note_id}/read",
        headers=bearer(owner["access_token"]),
    )
    assert second.status_code == 200
    assert second.json()["read_at"] == read_at

    put = await client.put(
        "/api/v1/me/notification-preferences",
        headers=bearer(owner["access_token"]),
        json={"notification_type": "user.registered", "in_app": True, "email": False},
    )
    assert put.status_code == 200, put.text
    got = await client.get(
        "/api/v1/me/notification-preferences",
        headers=bearer(owner["access_token"]),
    )
    assert got.status_code == 200
    saved = next(row for row in got.json() if row["notification_type"] == "user.registered")
    assert saved["in_app"] is True
    assert saved["email"] is False
    availability = put.json()["channel_availability"]
    assert availability["in_app"] == "AVAILABLE"
    assert availability["email"] == "STUB"
    assert availability["sms"] == "NOT_AVAILABLE"
    assert availability["push"] == "NOT_AVAILABLE"

    changed = await client.post(
        "/api/v1/auth/password/change",
        headers=bearer(owner["access_token"]),
        json={"current_password": "password12", "new_password": "password99"},
    )
    assert changed.status_code == 200, changed.text
    new_token = changed.json()["access_token"]
    await drain_outbox({})
    after_pw = await client.get("/api/v1/me/notifications", headers=bearer(new_token))
    assert after_pw.status_code == 200
    types = {row["type"] for row in after_pw.json()}
    assert "password.changed" in types
    assert all(row["id"] != note_id or row["status"] == "READ" for row in after_pw.json())


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_analytics_workspace_date_finance_campaign_idor(client: AsyncClient) -> None:
    staff, org_id = await _platform_admin(client)
    label = (await client.get("/api/v1/organizations", headers=bearer(staff))).json()["items"]
    label_id = next(row["id"] for row in label if row["type"] == "LABEL")

    no_ws = await register_and_login(client, "qa.p13.noworkspace@example.com")
    missing_ws = await client.get(
        "/api/v1/staff/analytics/overview",
        headers=bearer(no_ws["access_token"]),
    )
    assert missing_ws.status_code == 409
    assert missing_ws.headers["content-type"].startswith("application/problem+json")
    assert missing_ws.json()["code"] == "WORKSPACE_REQUIRED"
    assert missing_ws.json()["correlation_id"]

    analyst = await register_and_login(client, "qa.p13.analyst.http@example.com")
    await _assign_role(client, staff, analyst["user"]["id"], org_id, "analyst")
    analyst_token = await _workspace(client, analyst["access_token"], org_id)

    ledger = await client.get("/api/v1/ledger", headers=bearer(analyst_token))
    assert ledger.status_code in {403, 404}

    bad_range = await client.get(
        "/api/v1/staff/analytics/overview",
        headers=bearer(analyst_token),
        params={"from": "2026-09-11", "to": "2026-09-10"},
    )
    assert bad_range.status_code == 400
    assert bad_range.json()["code"] == "INVALID_DATE_RANGE"
    assert bad_range.json()["correlation_id"]

    overview = await client.get(
        "/api/v1/staff/analytics/overview",
        headers=bearer(analyst_token),
        params={"from": "2026-09-10", "to": "2026-09-11"},
    )
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert body["tracks"]["unique_listeners"] == "NOT_AVAILABLE"
    assert body["money"]["status"] == "NOT_AVAILABLE"
    assert body["campaigns"]["attribution_status"] == "ATTRIBUTION_UNDEFINED"
    assert "cac" not in body
    assert "roas" not in body
    assert body["metric_timezone_status"] == "ASSUMED"

    marketer = await register_and_login(client, "qa.p13.marketing.http@example.com")
    await _assign_role(client, staff, marketer["user"]["id"], org_id, "marketing_manager")
    marketer_token = await _workspace(client, marketer["access_token"], org_id)
    created = await client.post(
        "/api/v1/campaigns",
        headers=bearer(marketer_token),
        json={"title": "QA_P13_CAMPAIGN_HTTP"},
    )
    assert created.status_code == 201, created.text
    campaign_id = created.json()["id"]
    campaign_analytics = await client.get(
        f"/api/v1/analytics/campaigns/{campaign_id}",
        headers=bearer(marketer_token),
    )
    assert campaign_analytics.status_code == 200
    assert campaign_analytics.json()["attribution_status"] == "ATTRIBUTION_UNDEFINED"

    expense = await client.post(
        "/api/v1/expenses",
        headers=bearer(marketer_token),
        json={
            "category": "MARKETING",
            "amount_minor": 100,
            "currency_code": "BDT",
            "source_type": "manual",
            "source_id": str(uuid4()),
        },
    )
    assert expense.status_code == 404

    other_event = uuid4()
    idor = await client.get(
        f"/api/v1/analytics/events/{other_event}",
        headers=bearer(analyst_token),
    )
    assert idor.status_code == 404

    label_ws = await _workspace(client, staff, label_id)
    cross_campaign = await client.get(
        f"/api/v1/analytics/campaigns/{campaign_id}",
        headers=bearer(label_ws),
    )
    assert cross_campaign.status_code == 404

    empty_search = await client.get("/api/v1/search", params={"q": ""})
    assert empty_search.status_code == 200
    assert empty_search.json()["items"] == []

    health = await client.get("/health")
    assert health.status_code == 200
    openapi = await client.get("/openapi.json")
    assert openapi.status_code == 200
    paths = openapi.json()["paths"]
    assert "/api/v1/me/notifications" in paths
    assert "/api/v1/search" in paths
    assert "/api/v1/staff/analytics/overview" in paths
