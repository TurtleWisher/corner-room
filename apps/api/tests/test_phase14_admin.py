"""Phase 14 — admin inspect, ops visibility, production hardening."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from cornerroom.infra.settings import Settings
from cornerroom.kernel.authorize import decide_authorize
from cornerroom.kernel.health_status import (
    DEGRADED,
    EMAIL_STUB_HONESTY,
    HEALTHY,
    NOT_AVAILABLE,
    NOT_CONFIGURED,
    UNAVAILABLE,
    contains_secret_fragment,
    overall_status,
    public_dependency_checks,
)
from cornerroom.main import create_app
from cornerroom.modules.administration.application.ops_service import REGISTERED_JOBS, _scrub
from cornerroom.modules.analytics.domain.metrics import UNIQUE_LISTENERS_NOT_AVAILABLE, attribution_status
from cornerroom.worker import WorkerSettings
from tests.auth_helpers import admin_token, bearer, register_and_login, register_user, activate_user


def _app():
    return create_app(
        Settings(app_env="test", jwt_secret="test-secret-not-for-production-use-please"),
        enable_lifespan=False,
    )


def test_openapi_includes_phase14_paths() -> None:
    paths = _app().openapi()["paths"]
    assert "/api/v1/users" in paths
    assert "/api/v1/users/{user_id}" in paths
    assert "/api/v1/users/{user_id}/lifecycle" in paths
    assert "/api/v1/staff/ops/overview" in paths
    assert "/api/v1/staff/ops/outbox" in paths
    assert "/api/v1/audit" in paths
    assert "/admin/sql" not in paths
    assert "/admin/env" not in paths
    assert "/admin/secrets" not in paths
    assert "POST" not in paths["/api/v1/staff/ops/overview"]
    assert "POST" not in paths["/api/v1/staff/ops/outbox"]
    assert "DELETE" not in paths.get("/api/v1/audit", {})


def test_health_vocabulary_and_no_secret_fragments() -> None:
    assert overall_status(database_ok=True, redis_ok=True) == HEALTHY
    assert overall_status(database_ok=True, redis_ok=False) == DEGRADED
    assert overall_status(database_ok=False, redis_ok=False) == UNAVAILABLE
    assert (
        overall_status(database_ok=True, redis_ok=True, treat_email_stub_as_degraded=True)
        == DEGRADED
    )
    checks = public_dependency_checks(database_ok=True, redis_ok=True)
    assert checks["email"]["status"] == NOT_CONFIGURED
    assert checks["email"]["honesty"] == EMAIL_STUB_HONESTY
    assert checks["sms"]["status"] == NOT_AVAILABLE
    dumped = json.dumps(checks).lower()
    assert "password" not in dumped
    assert "jwt" not in dumped
    assert not contains_secret_fragment(dumped)


def test_phase13_honesty_not_rewritten() -> None:
    assert UNIQUE_LISTENERS_NOT_AVAILABLE == "NOT_AVAILABLE"
    assert attribution_status() == "ATTRIBUTION_UNDEFINED"


def test_no_admin_star_permission() -> None:
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    assert (
        decide_authorize(
            permission="admin.*",
            now=now,
            assignments=[],
            grants=[],
            memberships=[],
            user_id=uuid4(),
        )
        is False
    )


def test_outbox_payload_scrubs_secrets() -> None:
    assert _scrub({"token": "abc", "event_type": "UserRegistered"}) == {
        "token": "***",
        "event_type": "UserRegistered",
    }
    assert _scrub({"jwt_secret": "abc", "api_key": "k", "event_type": "UserRegistered"}) == {
        "jwt_secret": "***",
        "api_key": "***",
        "event_type": "UserRegistered",
    }


def test_registered_jobs_match_worker() -> None:
    assert set(REGISTERED_JOBS) == {fn.__name__ for fn in WorkerSettings.functions}


def test_local_dev_still_allows_debug_and_default_secret() -> None:
    settings = Settings(app_env="local", jwt_secret="change-me-to-a-long-random-secret", log_level="DEBUG")
    assert settings.is_production is False
    assert settings.log_level == "DEBUG"


def test_production_rejects_wildcard_cors_and_debug() -> None:
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            jwt_secret="a-sufficiently-long-production-secret!!",
            cookie_secure=True,
            cors_origins=["*"],
        )
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            jwt_secret="a-sufficiently-long-production-secret!!",
            cookie_secure=True,
            log_level="DEBUG",
        )


def test_production_disables_openapi() -> None:
    app = create_app(
        Settings(
            app_env="production",
            jwt_secret="a-sufficiently-long-production-secret!!",
            cookie_secure=True,
            cors_origins=["https://cornerroom.example"],
            log_level="INFO",
        ),
        enable_lifespan=False,
    )
    assert app.docs_url is None
    assert app.redoc_url is None
    assert app.openapi_url is None


@pytest.mark.asyncio
async def test_health_body_has_no_secrets() -> None:
    app = _app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
    body = response.json()
    dumped = json.dumps(body).lower()
    assert response.status_code == 200
    assert "password" not in dumped
    assert "secret" not in dumped
    assert "jwt" not in dumped
    assert body["checks"]["email"]["honesty"] == EMAIL_STUB_HONESTY


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ordinary_user_cannot_use_admin_or_ops(client: AsyncClient) -> None:
    session = await register_and_login(client, "fan-p14@example.com")
    headers = bearer(session["access_token"])
    listed = await client.get("/api/v1/users", headers=headers)
    assert listed.status_code == 403
    other = await register_user(client, "other-p14@example.com")
    inspect = await client.get(f"/api/v1/users/{other['id']}", headers=headers)
    assert inspect.status_code == 403
    ops = await client.get("/api/v1/staff/ops/overview", headers=headers)
    assert ops.status_code == 403
    outbox = await client.get("/api/v1/staff/ops/outbox", headers=headers)
    assert outbox.status_code == 403


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_anonymous_cannot_use_admin_or_ops(client: AsyncClient) -> None:
    listed = await client.get("/api/v1/users")
    assert listed.status_code == 401
    inspect = await client.get(f"/api/v1/users/{uuid4()}")
    assert inspect.status_code == 401
    ops = await client.get("/api/v1/staff/ops/overview")
    assert ops.status_code == 401
    outbox = await client.get("/api/v1/staff/ops/outbox")
    assert outbox.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_admin_user_inspect_org_isolation_and_lifecycle(client: AsyncClient) -> None:
    admin = await admin_token(client)
    org_a = await client.post(
        "/api/v1/organizations",
        headers=bearer(admin),
        json={"name": "P14 Org A", "type": "LABEL"},
    )
    org_b = await client.post(
        "/api/v1/organizations",
        headers=bearer(admin),
        json={"name": "P14 Org B", "type": "LABEL"},
    )
    assert org_a.status_code == 201, org_a.text
    assert org_b.status_code == 201, org_b.text
    await client.post(
        f"/api/v1/organizations/{org_a.json()['id']}/lifecycle",
        headers=bearer(admin),
        json={"action": "activate"},
    )
    await client.post(
        f"/api/v1/organizations/{org_b.json()['id']}/lifecycle",
        headers=bearer(admin),
        json={"action": "activate"},
    )
    user_a = await register_user(client, "member-a-p14@example.com")
    user_b = await register_user(client, "member-b-p14@example.com")
    await activate_user(client, user_a["id"])
    await activate_user(client, user_b["id"])
    add_a = await client.post(
        f"/api/v1/organizations/{org_a.json()['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": user_a["id"], "status": "ACTIVE"},
    )
    add_b = await client.post(
        f"/api/v1/organizations/{org_b.json()['id']}/memberships",
        headers=bearer(admin),
        json={"user_id": user_b["id"], "status": "ACTIVE"},
    )
    assert add_a.status_code == 201, add_a.text
    assert add_b.status_code == 201, add_b.text
    switched = await client.post(
        f"/api/v1/organizations/{org_a.json()['id']}/switch",
        headers=bearer(admin),
    )
    assert switched.status_code == 200, switched.text
    token_a = switched.json()["access_token"]
    listed = await client.get("/api/v1/users", headers=bearer(token_a))
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()["items"]}
    assert user_a["id"] in ids
    assert user_b["id"] not in ids
    inspect_b = await client.get(f"/api/v1/users/{user_b['id']}", headers=bearer(token_a))
    assert inspect_b.status_code == 404
    inspect_a = await client.get(f"/api/v1/users/{user_a['id']}", headers=bearer(token_a))
    assert inspect_a.status_code == 200
    assert "password" not in inspect_a.text.lower()
    assert "password_hash" not in inspect_a.text
    suspended = await client.post(
        f"/api/v1/users/{user_a['id']}/lifecycle",
        headers=bearer(token_a),
        json={"action": "suspend"},
    )
    assert suspended.status_code == 200
    assert suspended.json()["status"] == "SUSPENDED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ops_overview_honesty_and_no_force_payout(client: AsyncClient) -> None:
    admin = await admin_token(client)
    overview = await client.get("/api/v1/staff/ops/overview", headers=bearer(admin))
    assert overview.status_code == 200, overview.text
    body = overview.json()
    dumped = json.dumps(body).lower()
    assert "password" not in dumped
    assert "jwt" not in dumped
    assert body["notifications"]["email"]["honesty"] == EMAIL_STUB_HONESTY
    assert body["analytics"]["unique_listeners"] == UNIQUE_LISTENERS_NOT_AVAILABLE
    assert body["analytics"]["money"]["status"] == NOT_AVAILABLE
    assert body["analytics"]["attribution"] == "ATTRIBUTION_UNDEFINED"
    assert body["finance"]["force_payout"] == "forbidden"
    assert body["finance"]["mutation"] == "forbidden"
    assert body["finance"]["repair"] == "forbidden"
    assert "reconciliation_by_status" in body["finance"]
    assert body["jobs"]["worker_process"]["status"] == NOT_CONFIGURED
    assert body["search"]["rebuild"]["status"] == NOT_CONFIGURED
    assert body["security"]["source"] == "audit"
    assert body["security"]["impersonation"] == "not_implemented"
    assert "latest_metric_date" in body["analytics"]
    outbox = await client.get("/api/v1/staff/ops/outbox", headers=bearer(admin))
    assert outbox.status_code == 200
    assert "items" in outbox.json()
    force = await client.post("/api/v1/staff/ops/overview", headers=bearer(admin), json={})
    assert force.status_code == 405
