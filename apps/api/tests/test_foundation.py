"""Phase 01 foundation scenarios (config, health, errors, tx, outbox, storage, secrets)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4
import os

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from cornerroom.infra.errors import ConflictError, ResidencyGateError
from cornerroom.infra.idempotency import (
    IdempotencyReplay,
    begin_idempotent,
    complete_idempotent,
    fingerprint_payload,
)
from cornerroom.infra.logging import redact_processor
from cornerroom.infra.outbox import (
    OUTBOX_FAILED,
    OUTBOX_PENDING,
    OUTBOX_PUBLISHED,
    OutboxEvent,
    enqueue_outbox,
)
from cornerroom.infra.settings import Settings
from cornerroom.infra.storage import LocalObjectStorage, assert_storage_class_allowed, build_object_key
from cornerroom.kernel.correlation import resolve_correlation_id, sanitize_correlation_id
from cornerroom.kernel.events import FOUNDATION_PROBE, DomainEvent
from cornerroom.kernel.ids import new_uuid
from cornerroom.kernel.pagination import clamp_limit
from cornerroom.main import create_app
from cornerroom.worker import drain_outbox


def _app() -> object:
    return create_app(
        Settings(app_env="test", jwt_secret="test-secret-not-for-production-use-please"),
        enable_lifespan=False,
    )


@pytest.mark.asyncio
async def test_application_startup_factory() -> None:
    app = _app()
    assert app.title == "Corner Room API"


def test_invalid_configuration_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(database_url="mysql://localhost/nope")
    with pytest.raises(ValidationError):
        Settings(redis_url="http://localhost:6379/0")
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            jwt_secret="change-me-to-a-long-random-secret",
            cookie_secure=True,
        )
    with pytest.raises(ValidationError):
        Settings(
            app_env="production",
            jwt_secret="a-sufficiently-long-production-secret!!",
            cookie_secure=False,
        )
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


@pytest.mark.asyncio
async def test_postgres_and_redis_unavailable_ready_is_503() -> None:
    from cornerroom.infra.db import dispose_engine, init_engine
    from cornerroom.infra.redis import dispose_redis, init_redis

    bad = Settings(
        app_env="test",
        jwt_secret="test-secret-not-for-production-use-please",
        database_url="postgresql+asyncpg://cornerroom:cornerroom@127.0.0.1:1/cornerroom",
        redis_url="redis://127.0.0.1:1/0",
        redis_socket_timeout_seconds=0.2,
    )
    await dispose_engine()
    await dispose_redis()
    init_engine(bad)
    init_redis(bad)
    app = create_app(bad, enable_lifespan=False)
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            ready = await client.get("/health/ready")
            health = await client.get("/health")
        assert ready.status_code == 503
        assert ready.json()["checks"]["database"]["ok"] is False
        assert ready.json()["checks"]["redis"]["ok"] is False
        assert health.status_code == 200
        assert health.json()["status"] == "UNAVAILABLE"
        assert "password" not in health.text.lower()
        assert "secret" not in health.text.lower()
    finally:
        await dispose_engine()
        await dispose_redis()


@pytest.mark.asyncio
async def test_health_and_live_and_security_headers() -> None:
    app = _app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        live = await client.get("/health/live")
        health = await client.get("/health")
    assert live.status_code == 200
    assert live.json()["status"] == "HEALTHY"
    assert health.headers.get("x-content-type-options") == "nosniff"
    assert health.headers.get("x-frame-options") == "DENY"
    assert "x-request-id" in {k.lower() for k in live.headers}


@pytest.mark.asyncio
async def test_validation_and_standardized_error_and_correlation_id() -> None:
    app = _app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        supplied = "client-corr-id-001"
        validation = await client.post(
            "/api/v1/auth/login",
            json={"email": "not-an-email"},
            headers={"X-Correlation-ID": supplied, "X-Request-ID": supplied},
        )
        missing = await client.get("/definitely-missing", headers={"X-Request-ID": supplied})
        garbage = await client.get("/health/live", headers={"X-Request-ID": "bad id with spaces"})
    assert validation.status_code == 422
    body = validation.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["type"].startswith("https://cornerroom.local/problems/")
    assert body["instance"] == "/api/v1/auth/login"
    assert body["correlation_id"] == supplied
    assert body["request_id"] == supplied
    assert validation.headers["x-correlation-id"] == supplied
    assert missing.status_code == 404
    assert missing.json()["code"] == "NOT_FOUND"
    assert missing.json()["correlation_id"] == supplied
    assert sanitize_correlation_id("bad id with spaces") is None
    assert garbage.headers["x-request-id"] != "bad id with spaces"
    assert resolve_correlation_id(None).count("-") == 4


def test_secrets_are_redacted_from_structured_logs() -> None:
    redacted = redact_processor(
        None,
        "info",
        {
            "password": "hunter2",
            "jwt_secret": "super-secret",
            "access_token": "abc",
            "user": "ok",
            "nested": {"refresh_token": "nope"},
        },
    )
    assert redacted["password"] == "***"
    assert redacted["jwt_secret"] == "***"
    assert redacted["access_token"] == "***"
    assert redacted["user"] == "ok"
    assert redacted["nested"]["refresh_token"] == "***"


def test_pagination_clamp() -> None:
    assert clamp_limit(None) == 50
    assert clamp_limit(0) == 1
    assert clamp_limit(500) == 100


@pytest.mark.asyncio
async def test_object_storage_local_roundtrip(tmp_path) -> None:
    storage = LocalObjectStorage(str(tmp_path))
    key = build_object_key("campaign_asset", new_uuid(), "banner.jpg")
    stored = await storage.put(
        object_key=key, data=b"jpg", mime="image/jpeg", storage_class="campaign_asset"
    )
    assert stored.object_key == key
    assert await storage.get_bytes(key) == b"jpg"
    url = await storage.signed_url(key)
    assert key in url
    settings = Settings(
        app_env="production",
        jwt_secret="a-sufficiently-long-production-secret!!",
        cookie_secure=True,
    )
    with pytest.raises(ResidencyGateError):
        assert_storage_class_allowed("catalog_audio", settings)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_transaction_commit_and_rollback(pg_session: AsyncSession) -> None:
    event = DomainEvent(
        event_type=FOUNDATION_PROBE,
        producer="tests",
        aggregate_type="Foundation",
        aggregate_id=uuid4(),
        payload={"ok": True},
        occurred_at=datetime.now(timezone.utc),
        correlation_id="tx-test-1",
    )
    await enqueue_outbox(pg_session, event)
    await pg_session.commit()
    found = await pg_session.get(OutboxEvent, event.event_id)
    assert found is not None
    assert found.correlation_id == "tx-test-1"

    rolling = DomainEvent(
        event_type=FOUNDATION_PROBE,
        producer="tests",
        aggregate_type="Foundation",
        aggregate_id=uuid4(),
        payload={"ok": False},
        occurred_at=datetime.now(timezone.utc),
    )
    await enqueue_outbox(pg_session, rolling)
    await pg_session.rollback()
    pg_session.expire_all()
    missing = await pg_session.get(OutboxEvent, rolling.event_id)
    assert missing is None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_outbox_same_transaction_and_worker_retry_failure_duplicate(
    pg_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from cornerroom.infra import outbox_dispatch
    from cornerroom.infra import db as db_mod

    engine = pg_session.bind
    assert engine is not None
    db_mod._engine = engine  # type: ignore[attr-defined]
    db_mod._session_factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)

    calls = {"n": 0}

    async def flaky(event: DomainEvent, session: AsyncSession) -> None:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")

    original = dict(outbox_dispatch.HANDLERS)
    outbox_dispatch.register_handler(FOUNDATION_PROBE, flaky)
    try:
        event = DomainEvent(
            event_type=FOUNDATION_PROBE,
            producer="tests",
            aggregate_type="Foundation",
            aggregate_id=uuid4(),
            payload={"n": 1},
            occurred_at=datetime.now(timezone.utc),
            correlation_id="worker-test",
        )
        await enqueue_outbox(pg_session, event)
        await pg_session.commit()

        first = await drain_outbox({})
        assert first == 0
        pg_session.expire_all()
        row = await pg_session.get(OutboxEvent, event.event_id)
        assert row is not None
        assert row.status == OUTBOX_PENDING
        assert row.attempts == 1
        row.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await pg_session.commit()

        second = await drain_outbox({})
        assert second == 1
        pg_session.expire_all()
        row = await pg_session.get(OutboxEvent, event.event_id)
        assert row is not None
        assert row.status == OUTBOX_PUBLISHED

        third = await drain_outbox({})
        assert third == 0
        pg_session.expire_all()
        row = await pg_session.get(OutboxEvent, event.event_id)
        assert row is not None
        assert row.status == OUTBOX_PUBLISHED
        assert calls["n"] == 2
    finally:
        outbox_dispatch.HANDLERS.clear()
        outbox_dispatch.HANDLERS.update(original)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_outbox_exhausts_retries(pg_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    from cornerroom.infra import outbox_dispatch
    from cornerroom.infra import db as db_mod

    engine = pg_session.bind
    assert engine is not None
    db_mod._engine = engine  # type: ignore[attr-defined]
    db_mod._session_factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)

    async def always_fail(event: DomainEvent, session: AsyncSession) -> None:
        raise RuntimeError("still broken")

    original = dict(outbox_dispatch.HANDLERS)
    outbox_dispatch.register_handler(FOUNDATION_PROBE, always_fail)
    monkeypatch.setenv("OUTBOX_MAX_ATTEMPTS", "1")
    from cornerroom.infra.settings import get_settings

    get_settings.cache_clear()
    try:
        event = DomainEvent(
            event_type=FOUNDATION_PROBE,
            producer="tests",
            aggregate_type="Foundation",
            aggregate_id=uuid4(),
            payload={},
            occurred_at=datetime.now(timezone.utc),
        )
        await enqueue_outbox(pg_session, event)
        await pg_session.commit()
        await drain_outbox({})
        pg_session.expire_all()
        row = await pg_session.get(OutboxEvent, event.event_id)
        assert row is not None
        assert row.status == OUTBOX_FAILED
        assert row.last_error
    finally:
        outbox_dispatch.HANDLERS.clear()
        outbox_dispatch.HANDLERS.update(original)
        get_settings.cache_clear()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_idempotency_replay_and_conflict(pg_session: AsyncSession) -> None:
    key = f"foundation:{uuid4()}"
    digest = fingerprint_payload({"a": 1})
    first = await begin_idempotent(pg_session, key=key, request_hash=digest, ttl_seconds=60)
    assert not isinstance(first, IdempotencyReplay)
    await complete_idempotent(pg_session, first, status_code=201, body='{"ok":true}')
    replay = await begin_idempotent(pg_session, key=key, request_hash=digest, ttl_seconds=60)
    assert isinstance(replay, IdempotencyReplay)
    assert replay.status_code == 201
    with pytest.raises(ConflictError):
        await begin_idempotent(pg_session, key=key, request_hash=fingerprint_payload({"a": 2}), ttl_seconds=60)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_migration_upgrade_and_consistency(postgres_available: str | None) -> None:
    if not postgres_available:
        pytest.skip("PostgreSQL is not available")
    from alembic import command
    from alembic.config import Config
    from pathlib import Path
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(postgres_available)
    async with engine.begin() as conn:
        for schema in ("identity", "permissions", "audit", "notifications", "documents", "infra"):
            await conn.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
    await engine.dispose()

    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    sync_url = postgres_available.replace("+asyncpg", "+psycopg")
    os.environ["ALEMBIC_DATABASE_URL"] = sync_url
    cfg.set_main_option("sqlalchemy.url", sync_url)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "0001_foundation")
    command.upgrade(cfg, "head")

    engine = create_async_engine(postgres_available)
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    """
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'infra' AND table_name = 'outbox_events'
                    """
                )
            )
        ).fetchall()
        names = {row[0] for row in rows}
        assert "correlation_id" in names
        assert "next_attempt_at" in names
        assert "occurred_at" in names
    await engine.dispose()
