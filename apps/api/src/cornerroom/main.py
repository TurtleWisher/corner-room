"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cornerroom import __version__
from cornerroom.api.health import router as health_router
from cornerroom.api.v1.artists import router as artists_router
from cornerroom.api.v1.audit import router as audit_router
from cornerroom.api.v1.auth import router as auth_router
from cornerroom.api.v1.bands import router as bands_router
from cornerroom.api.v1.campaigns import router as campaigns_router
from cornerroom.api.v1.events import router as events_router
from cornerroom.api.v1.ticketing import router as ticketing_router
from cornerroom.api.v1.tracks import router as tracks_router
from cornerroom.api.v1.releases import router as releases_router
from cornerroom.api.v1.streaming import router as streaming_router
from cornerroom.api.v1.commerce import router as commerce_router
from cornerroom.api.v1.subscriptions import router as subscriptions_router
from cornerroom.api.v1.royalties import router as royalties_router
from cornerroom.api.v1.finance import router as finance_router
from cornerroom.api.v1.me import router as me_router
from cornerroom.api.v1.notifications import router as notifications_router
from cornerroom.api.v1.organizations import router as orgs_router
from cornerroom.api.v1.roles import router as roles_router
from cornerroom.api.v1.uploads import router as uploads_router
from cornerroom.api.v1.users import router as users_router
from cornerroom.api.v1.venues import router as venues_router
from cornerroom.infra.db import dispose_engine, get_session_factory, init_engine
from cornerroom.infra.errors import register_exception_handlers
from cornerroom.infra.logging import configure_logging
from cornerroom.infra.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from cornerroom.infra.redis import dispose_redis, init_redis
from cornerroom.infra.seed import seed_foundation
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.modules.finance.application.handlers import register_finance_handlers
from cornerroom.modules.streaming.application.service import register_streaming_handlers

log = structlog.get_logger("app")


def create_app(settings: Settings | None = None, *, enable_lifespan: bool = True) -> FastAPI:
    cfg = settings or get_settings()
    register_streaming_handlers()
    register_finance_handlers()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        configure_logging(cfg.log_level, service="api", environment=cfg.app_env)
        register_streaming_handlers()
        register_finance_handlers()
        init_engine(cfg)
        init_redis(cfg)
        try:
            factory = get_session_factory()
            async with factory() as session:
                await seed_foundation(session, cfg)
                await session.commit()
        except Exception:
            log.exception("startup_seed_failed")
            if cfg.app_env not in {"local", "development", "test"}:
                raise
        yield
        await dispose_redis()
        await dispose_engine()

    app = FastAPI(
        title="Corner Room API",
        version=__version__,
        description="Corner Room API — modular monolith platform foundation.",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan if enable_lifespan else None,
    )
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(me_router, prefix="/api/v1")
    app.include_router(users_router, prefix="/api/v1")
    app.include_router(orgs_router, prefix="/api/v1")
    app.include_router(ticketing_router, prefix="/api/v1")
    app.include_router(events_router, prefix="/api/v1")
    app.include_router(venues_router, prefix="/api/v1")
    app.include_router(artists_router, prefix="/api/v1")
    app.include_router(bands_router, prefix="/api/v1")
    app.include_router(tracks_router, prefix="/api/v1")
    app.include_router(releases_router, prefix="/api/v1")
    app.include_router(streaming_router, prefix="/api/v1")
    app.include_router(commerce_router, prefix="/api/v1")
    app.include_router(subscriptions_router, prefix="/api/v1")
    app.include_router(royalties_router, prefix="/api/v1")
    app.include_router(finance_router, prefix="/api/v1")
    app.include_router(campaigns_router, prefix="/api/v1")
    app.include_router(roles_router, prefix="/api/v1")
    app.include_router(audit_router, prefix="/api/v1")
    app.include_router(notifications_router, prefix="/api/v1")
    app.include_router(uploads_router, prefix="/api/v1")
    return app


app = create_app()
