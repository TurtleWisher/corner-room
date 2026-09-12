"""Health endpoints."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from cornerroom.infra.settings import Settings
from cornerroom.main import create_app


@pytest.mark.asyncio
async def test_live() -> None:
    app = create_app(
        Settings(app_env="test", jwt_secret="test-secret-not-for-production-use-please"),
        enable_lifespan=False,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "HEALTHY"
    assert "x-request-id" in {k.lower() for k in response.headers}


@pytest.mark.asyncio
async def test_ready_without_deps_is_unavailable() -> None:
    from cornerroom.infra.db import dispose_engine, init_engine
    from cornerroom.infra.redis import dispose_redis, init_redis

    settings = Settings(
        app_env="test",
        jwt_secret="test-secret-not-for-production-use-please",
        database_url="postgresql+asyncpg://cornerroom:cornerroom@127.0.0.1:1/cornerroom",
        redis_url="redis://127.0.0.1:1/0",
        redis_socket_timeout_seconds=0.2,
    )
    await dispose_engine()
    await dispose_redis()
    init_engine(settings)
    init_redis(settings)
    app = create_app(settings, enable_lifespan=False)
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/health/ready")
        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "UNAVAILABLE"
        assert body["checks"]["database"]["status"] == "UNAVAILABLE"
        assert body["checks"]["redis"]["status"] == "UNAVAILABLE"
        assert body["checks"]["email"]["honesty"] == "EMAIL STUB"
        dumped = response.text.lower()
        assert "password" not in dumped
        assert "jwt" not in dumped
        assert "secret" not in dumped
    finally:
        await dispose_engine()
        await dispose_redis()


@pytest.mark.asyncio
async def test_validation_problem_json() -> None:
    app = create_app(Settings(app_env="test", jwt_secret="test-secret-not-for-production-use-please"), enable_lifespan=False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/auth/login", json={"email": "not-an-email"})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["status"] == 422
    assert "request_id" in body
