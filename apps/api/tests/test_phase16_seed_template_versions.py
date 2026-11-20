"""Startup seeding with several versions of a note template (2026-11-21).

Migration 0063 added a newer version of the gift note templates. The startup seed looked each type
up with scalar_one_or_none() and stopped the API from starting in production. Any number of versions
must be fine."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_seeding_again_with_newer_template_versions(client: AsyncClient) -> None:
    # `client` sets up the migrated test database.
    from cornerroom.infra.db import get_session_factory
    from cornerroom.infra.seed import seed_foundation
    from cornerroom.infra.settings import get_settings
    from cornerroom.modules.notifications.domain.models import NotificationTemplate

    factory = get_session_factory()
    async with factory() as session:
        await seed_foundation(session, get_settings())
        for ntype in ("gift.dispatched", "organization.invitation_issued"):
            session.add(NotificationTemplate(type=ntype, locale="en", version=99, body="A newer version"))
        await session.commit()
    async with factory() as session:
        await seed_foundation(session, get_settings())  # must not raise
        await session.commit()
        count = await session.scalar(
            select(func.count()).select_from(NotificationTemplate).where(NotificationTemplate.type == "gift.dispatched")
        )
    assert count >= 2
