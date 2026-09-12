"""Phase 13 Gate 4 — API (notifications, search, analytics)."""

from __future__ import annotations

from datetime import date
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.errors import AppError
from cornerroom.infra.settings import Settings
from cornerroom.main import create_app
from cornerroom.modules.analytics.application.service import AnalyticsService
from cornerroom.modules.analytics.domain.metrics import (
    UNIQUE_LISTENERS_NOT_AVAILABLE,
    attribution_status,
)
from cornerroom.modules.analytics.domain.models import DailyCampaignMetrics, DailyTrackMetrics
from cornerroom.modules.notifications.application.service import NotificationService
from cornerroom.modules.notifications.domain.policy import (
    CHANNEL_AVAILABILITY,
    CHANNEL_EMAIL,
    CHANNEL_IN_APP,
    CHANNEL_PUSH,
    CHANNEL_SMS,
    CHANNEL_STATUS_AVAILABLE,
    CHANNEL_STATUS_NOT_AVAILABLE,
    CHANNEL_STATUS_STUB,
)
from cornerroom.modules.search.application.indexer import SearchIndexer
from cornerroom.modules.search.application.service import SearchService
from cornerroom.modules.search.domain.visibility import (
    ENTITY_ARTIST,
    ENTITY_USER,
    GUEST_ENTITY_TYPES,
    VISIBILITY_PUBLIC,
    VISIBILITY_STAFF_ORG,
    VISIBILITY_UNAVAILABLE,
    route_for,
)
from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase07_catalog import _workspace


def _app():
    return create_app(
        Settings(app_env="test", jwt_secret="test-secret-not-for-production-use-please"),
        enable_lifespan=False,
    )


def test_openapi_includes_phase13_paths() -> None:
    spec = _app().openapi()
    paths = spec["paths"]
    assert "/api/v1/me/notifications" in paths
    assert "/api/v1/me/notifications/{notification_id}/read" in paths
    assert "/api/v1/me/notification-preferences" in paths
    assert "/api/v1/search" in paths
    assert "/api/v1/staff/analytics/overview" in paths
    assert "/api/v1/analytics/tracks/{track_id}" in paths
    assert "/api/v1/analytics/events/{event_id}" in paths
    assert "/api/v1/analytics/campaigns/{campaign_id}" in paths
    assert "/api/v1/analytics/artists/{artist_id}" in paths
    assert "/api/v1/artists/{artist_id}/play-aggregates" in paths
    assert "/api/v1/analytics/events" not in paths
    assert "POST" not in paths["/api/v1/search"]


def test_channel_availability_honesty() -> None:
    assert CHANNEL_AVAILABILITY[CHANNEL_IN_APP] == CHANNEL_STATUS_AVAILABLE
    assert CHANNEL_AVAILABILITY[CHANNEL_EMAIL] == CHANNEL_STATUS_STUB
    assert CHANNEL_AVAILABILITY[CHANNEL_SMS] == CHANNEL_STATUS_NOT_AVAILABLE
    assert CHANNEL_AVAILABILITY[CHANNEL_PUSH] == CHANNEL_STATUS_NOT_AVAILABLE


def test_guest_entity_types_exclude_staff_only() -> None:
    assert ENTITY_USER not in GUEST_ENTITY_TYPES
    assert "ORGANIZATION" not in GUEST_ENTITY_TYPES
    assert "CAMPAIGN" not in GUEST_ENTITY_TYPES
    assert "VENUE" not in GUEST_ENTITY_TYPES
    assert ENTITY_ARTIST in GUEST_ENTITY_TYPES


def test_search_route_metadata() -> None:
    artist_id = uuid4()
    assert route_for(ENTITY_ARTIST, artist_id) == f"/artists/{artist_id}"
    assert route_for(ENTITY_USER, artist_id) is None


def test_invalid_analytics_range_is_400() -> None:
    svc = AnalyticsService(MagicMock())
    with pytest.raises(AppError) as exc:
        svc.validate_metric_range(date(2026, 9, 10), date(2026, 9, 1))
    assert exc.value.status == 400
    assert exc.value.code == "INVALID_DATE_RANGE"


@pytest.mark.asyncio
async def test_empty_search_query_returns_empty_page() -> None:
    settings = Settings(
        app_env="test",
        jwt_secret="test-secret-not-for-production-use-please",
    )
    svc = SearchService(MagicMock(), settings=settings)
    items, cursor = await svc.query(None, q="   ")
    assert items == []
    assert cursor is None


async def _platform_admin(client: AsyncClient) -> tuple[str, str]:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    token = await _workspace(client, admin, platform["id"])
    return token, platform["id"]


async def _assign_role(
    client: AsyncClient, staff_token: str, user_id: str, org_id: str, key: str
) -> None:
    roles = (await client.get("/api/v1/roles", headers=bearer(staff_token))).json()
    role = next(row for row in roles if row["key"] == key)
    membership = await client.post(
        f"/api/v1/organizations/{org_id}/memberships",
        headers=bearer(staff_token),
        json={"user_id": user_id, "status": "ACTIVE", "role_id": role["id"]},
    )
    assert membership.status_code == 201, membership.text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_notifications_isolation_and_idempotent_read(client: AsyncClient) -> None:
    owner = await register_and_login(client, "notify-owner-p13@example.com")
    stranger = await register_and_login(client, "notify-stranger-p13@example.com")
    anon = await client.get("/api/v1/me/notifications")
    assert anon.status_code == 401

    missing_list = await client.get("/api/v1/notifications", params={"user_id": owner["user"]["id"]})
    assert missing_list.status_code in {404, 405, 422}

    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        row = await NotificationService(session).request(
            user_id=UUID(owner["user"]["id"]),
            notification_type="user.registered",
            title="Welcome to Corner Room",
            body="Your account is ready",
        )
        note_id = row.id
        await session.commit()

    listed = await client.get("/api/v1/me/notifications", headers=bearer(owner["access_token"]))
    assert listed.status_code == 200, listed.text
    items = listed.json()
    assert isinstance(items, list)
    assert any(row["id"] == str(note_id) for row in items)
    assert all("type" in row and "title" in row for row in items)

    hidden = await client.get("/api/v1/me/notifications", headers=bearer(stranger["access_token"]))
    assert hidden.status_code == 200
    assert all(row["id"] != str(note_id) for row in hidden.json())

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
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "READ"
    read_at = first.json()["read_at"]
    second = await client.post(
        f"/api/v1/me/notifications/{note_id}/read",
        headers=bearer(owner["access_token"]),
    )
    assert second.status_code == 200
    assert second.json()["status"] == "READ"
    assert second.json()["read_at"] == read_at

    prefs = await client.put(
        "/api/v1/me/notification-preferences",
        headers=bearer(owner["access_token"]),
        json={"notification_type": "user.registered", "in_app": True, "email": True},
    )
    assert prefs.status_code == 200, prefs.text
    availability = prefs.json()["channel_availability"]
    assert availability["in_app"] == CHANNEL_STATUS_AVAILABLE
    assert availability["email"] == CHANNEL_STATUS_STUB
    assert availability["sms"] == CHANNEL_STATUS_NOT_AVAILABLE
    assert availability["push"] == CHANNEL_STATUS_NOT_AVAILABLE


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_guest_search_public_only_and_org_filter_is_not_authority(
    client: AsyncClient,
) -> None:
    staff, org_id = await _platform_admin(client)
    label = (
        await client.get("/api/v1/organizations", headers=bearer(staff))
    ).json()["items"]
    label_id = next(row["id"] for row in label if row["type"] == "LABEL")
    public_id = uuid4()
    staff_hit_id = uuid4()
    hidden_id = uuid4()
    user_id = uuid4()
    other_org_public = uuid4()

    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        indexer = SearchIndexer(session)
        await indexer.upsert(
            entity_type=ENTITY_ARTIST,
            entity_id=public_id,
            organization_id=UUID(org_id),
            visibility=VISIBILITY_PUBLIC,
            title="Dhaka Nightingale",
            subtitle=None,
            searchable_text="Dhaka Nightingale",
            source_version=1,
        )
        await indexer.upsert(
            entity_type=ENTITY_ARTIST,
            entity_id=staff_hit_id,
            organization_id=UUID(org_id),
            visibility=VISIBILITY_STAFF_ORG,
            title="Dhaka Nightingale Draft",
            subtitle=None,
            searchable_text="Dhaka Nightingale Draft",
            source_version=1,
        )
        await indexer.upsert(
            entity_type=ENTITY_ARTIST,
            entity_id=hidden_id,
            organization_id=UUID(org_id),
            visibility=VISIBILITY_UNAVAILABLE,
            title="Dhaka Nightingale Hidden",
            subtitle=None,
            searchable_text="Dhaka Nightingale Hidden",
            source_version=1,
        )
        await indexer.upsert(
            entity_type=ENTITY_USER,
            entity_id=user_id,
            organization_id=UUID(org_id),
            visibility=VISIBILITY_PUBLIC,
            title="Dhaka Nightingale User",
            subtitle=None,
            searchable_text="Dhaka Nightingale User",
            source_version=1,
        )
        await indexer.upsert(
            entity_type=ENTITY_ARTIST,
            entity_id=other_org_public,
            organization_id=UUID(label_id),
            visibility=VISIBILITY_PUBLIC,
            title="Dhaka Nightingale Label",
            subtitle=None,
            searchable_text="Dhaka Nightingale Label",
            source_version=1,
        )
        await session.commit()

    empty = await client.get("/api/v1/search", params={"q": ""})
    assert empty.status_code == 200
    assert empty.json()["items"] == []
    assert empty.json()["next_cursor"] is None

    guest = await client.get("/api/v1/search", params={"q": "Nightingale"})
    assert guest.status_code == 200, guest.text
    ids = {row["entity_id"] for row in guest.json()["items"]}
    assert str(public_id) in ids
    assert str(other_org_public) in ids
    assert str(staff_hit_id) not in ids
    assert str(hidden_id) not in ids
    assert str(user_id) not in ids
    for row in guest.json()["items"]:
        assert row["entity_type"] in GUEST_ENTITY_TYPES
        assert row["visibility"] == VISIBILITY_PUBLIC
        assert "password" not in row
        assert "amount_minor" not in row
        assert "searchable_text" not in row
        assert row["route"]

    guest_user = await client.get(
        "/api/v1/search", params={"q": "Nightingale", "entity_type": "USER"}
    )
    assert guest_user.status_code == 200
    assert guest_user.json()["items"] == []

    filtered = await client.get(
        "/api/v1/search",
        params={"q": "Nightingale", "organization_id": label_id},
    )
    assert filtered.status_code == 200
    filtered_ids = {row["entity_id"] for row in filtered.json()["items"]}
    assert str(other_org_public) in filtered_ids
    assert str(public_id) not in filtered_ids
    assert str(staff_hit_id) not in filtered_ids

    analyst = await register_and_login(client, "search-analyst-p13@example.com")
    await _assign_role(client, staff, analyst["user"]["id"], org_id, "analyst")
    analyst_token = await _workspace(client, analyst["access_token"], org_id)
    staff_search = await client.get(
        "/api/v1/search",
        params={"q": "Nightingale"},
        headers=bearer(analyst_token),
    )
    assert staff_search.status_code == 200, staff_search.text
    staff_ids = {row["entity_id"] for row in staff_search.json()["items"]}
    assert str(public_id) in staff_ids
    assert str(staff_hit_id) in staff_ids
    assert str(hidden_id) not in staff_ids
    assert str(user_id) not in staff_ids

    cross = await client.get(
        "/api/v1/search",
        params={"q": "Nightingale", "organization_id": label_id},
        headers=bearer(analyst_token),
    )
    cross_ids = {row["entity_id"] for row in cross.json()["items"]}
    assert str(other_org_public) in cross_ids
    assert str(staff_hit_id) not in cross_ids


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_analyst_vs_finance_unique_listeners_attribution_org_isolation(
    client: AsyncClient,
) -> None:
    staff, org_id = await _platform_admin(client)
    label = (
        await client.get("/api/v1/organizations", headers=bearer(staff))
    ).json()["items"]
    label_id = next(row["id"] for row in label if row["type"] == "LABEL")

    analyst = await register_and_login(client, "analyst-p13@example.com")
    await _assign_role(client, staff, analyst["user"]["id"], org_id, "analyst")
    analyst_token = await _workspace(client, analyst["access_token"], org_id)

    marketer = await register_and_login(client, "marketer-p13@example.com")
    await _assign_role(client, staff, marketer["user"]["id"], org_id, "marketing_manager")
    marketer_token = await _workspace(client, marketer["access_token"], org_id)

    anon = await client.get("/api/v1/staff/analytics/overview")
    assert anon.status_code == 401

    bad_range = await client.get(
        "/api/v1/staff/analytics/overview",
        headers=bearer(analyst_token),
        params={"from": "2026-09-10", "to": "2026-09-01"},
    )
    assert bad_range.status_code == 400
    assert bad_range.headers["content-type"].startswith("application/problem+json")
    assert bad_range.json()["code"] == "INVALID_DATE_RANGE"
    assert bad_range.json()["correlation_id"]

    created = await client.post(
        "/api/v1/campaigns",
        headers=bearer(marketer_token),
        json={"title": "Analytics campaign"},
    )
    assert created.status_code == 201, created.text
    campaign_id = created.json()["id"]
    assert created.json()["attribution_status"] == "ATTRIBUTION_UNDEFINED"

    track_id = uuid4()
    other_track = uuid4()
    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        session.add(
            DailyTrackMetrics(
                metric_date=date(2026, 9, 11),
                track_id=track_id,
                organization_id=UUID(org_id),
                play_count=4,
                completed_play_count=2,
                listen_duration_ms=1000,
            )
        )
        session.add(
            DailyTrackMetrics(
                metric_date=date(2026, 9, 11),
                track_id=other_track,
                organization_id=UUID(label_id),
                play_count=99,
                completed_play_count=99,
                listen_duration_ms=99000,
            )
        )
        session.add(
            DailyCampaignMetrics(
                metric_date=date(2026, 9, 11),
                campaign_id=UUID(campaign_id),
                organization_id=UUID(org_id),
                ingested_event_count=3,
            )
        )
        await session.commit()

    overview = await client.get(
        "/api/v1/staff/analytics/overview",
        headers=bearer(analyst_token),
    )
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert body["organization_id"] == org_id
    assert body["tracks"]["play_count"] == 4
    assert body["tracks"]["unique_listeners"] == UNIQUE_LISTENERS_NOT_AVAILABLE
    assert "cac" not in body
    assert "roas" not in body
    assert body["campaigns"]["attribution_status"] == attribution_status()
    assert body["money"]["status"] == "NOT_AVAILABLE"
    assert body["metric_timezone"] == "Asia/Dhaka"
    assert body["metric_timezone_status"] == "ASSUMED"

    ledger = await client.get("/api/v1/ledger", headers=bearer(analyst_token))
    assert ledger.status_code in {403, 404}

    label_ws = await _workspace(client, staff, label_id)
    label_overview = await client.get(
        "/api/v1/staff/analytics/overview",
        headers=bearer(label_ws),
    )
    assert label_overview.status_code == 200
    assert label_overview.json()["tracks"]["play_count"] == 99
    assert label_overview.json()["organization_id"] == label_id

    campaign_analytics = await client.get(
        f"/api/v1/analytics/campaigns/{campaign_id}",
        headers=bearer(marketer_token),
    )
    assert campaign_analytics.status_code == 200, campaign_analytics.text
    assert campaign_analytics.json()["attribution_status"] == "ATTRIBUTION_UNDEFINED"
    assert campaign_analytics.json()["ingested_event_count"] == 3
    assert "cac" not in campaign_analytics.json()
    assert "roas" not in campaign_analytics.json()

    analyst_campaign = await client.get(
        f"/api/v1/analytics/campaigns/{campaign_id}",
        headers=bearer(analyst_token),
    )
    assert analyst_campaign.status_code == 404

    label_campaign = await client.get(
        f"/api/v1/analytics/campaigns/{campaign_id}",
        headers=bearer(label_ws),
    )
    assert label_campaign.status_code == 404

    missing_track = await client.get(
        f"/api/v1/analytics/tracks/{track_id}",
        headers=bearer(analyst_token),
    )
    assert missing_track.status_code == 404
