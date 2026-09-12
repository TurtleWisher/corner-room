"""Pytest fixtures. Prefer Postgres (testcontainers or DATABASE_URL)."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from cornerroom.infra.settings import Settings, get_settings
from cornerroom.infra import models as _models  # noqa: F401


def _postgres_url() -> str | None:
    return os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")


def _try_testcontainers() -> str | None:
    try:
        from testcontainers.postgres import PostgresContainer
    except Exception:
        return None
    try:
        container = PostgresContainer("postgres:16-alpine")
        container.start()
        url = container.get_connection_url()
        # testcontainers gives psycopg2-style; convert to asyncpg
        if url.startswith("postgresql+psycopg2://"):
            url = url.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        os.environ["_TESTCONTAINER_PG"] = "1"
        _try_testcontainers.container = container  # type: ignore[attr-defined]
        return url
    except Exception:
        return None


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "postgres: needs PostgreSQL")


@pytest.fixture(scope="session")
def postgres_available() -> str | None:
    url = _postgres_url()
    if url:
        return url
    return _try_testcontainers()


@pytest_asyncio.fixture(autouse=True)
async def _reset_global_engine() -> AsyncIterator[None]:
    """Dispose process-global engine/redis on the same loop that created them."""
    yield
    from cornerroom.infra.db import dispose_engine
    from cornerroom.infra.redis import dispose_redis

    await dispose_engine()
    await dispose_redis()


@pytest.fixture
def settings() -> Settings:
    get_settings.cache_clear()
    return Settings(
        app_env="test",
        jwt_secret="test-secret-not-for-production-use-please",
        cors_origins=["http://localhost:3000"],
        cookie_secure=False,
        database_url=os.environ.get(
            "DATABASE_URL",
            "postgresql+asyncpg://cornerroom:cornerroom@localhost:5432/cornerroom",
        ),
        redis_url=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
    )


@pytest_asyncio.fixture
async def pg_session(postgres_available: str | None) -> AsyncIterator[AsyncSession]:
    if not postgres_available:
        pytest.skip("PostgreSQL is not available (no Docker / no DATABASE_URL)")
    from cornerroom.infra.base import Base
    from sqlalchemy import text

    engine = create_async_engine(postgres_available, pool_pre_ping=True)
    async with engine.begin() as conn:
        for schema in (
            "identity",
            "permissions",
            "audit",
            "notifications",
            "documents",
            "infra",
            "events",
            "artists",
            "music",
            "streaming",
            "ticketing",
            "commerce",
            "finance",
            "subscriptions",
            "royalties",
            "campaigns",
            "search",
            "analytics",
        ):
            await conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {schema}"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    async with factory() as session:
        yield session
        await session.rollback()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def client(settings: Settings, postgres_available: str | None) -> AsyncIterator[AsyncClient]:
    if not postgres_available:
        pytest.skip("PostgreSQL is not available (no Docker / no DATABASE_URL)")
    os.environ["APP_ENV"] = "test"
    os.environ["DATABASE_URL"] = postgres_available
    sync_url = postgres_available.replace("+asyncpg", "+psycopg")
    os.environ["DATABASE_URL_SYNC"] = sync_url
    os.environ["JWT_SECRET"] = settings.jwt_secret
    os.environ["BOOTSTRAP_ADMIN_EMAIL"] = "admin@example.com"
    os.environ["BOOTSTRAP_ADMIN_PASSWORD"] = "adminpass12"
    get_settings.cache_clear()

    from cornerroom.infra.base import Base
    from cornerroom.infra.db import dispose_engine, get_engine, init_engine
    from cornerroom.infra.seed import seed_foundation
    from cornerroom.main import create_app
    from sqlalchemy import text

    init_engine(get_settings())
    engine = get_engine()
    async with engine.begin() as conn:
        for schema in (
            "identity",
            "permissions",
            "audit",
            "notifications",
            "documents",
            "infra",
            "events",
            "artists",
            "music",
            "streaming",
            "ticketing",
            "commerce",
            "finance",
            "subscriptions",
            "royalties",
            "campaigns",
            "search",
            "analytics",
        ):
            await conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {schema}"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        await seed_foundation(session, get_settings())
        await session.commit()

    app = create_app(get_settings())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await dispose_engine()
    get_settings.cache_clear()
