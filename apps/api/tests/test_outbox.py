"""Outbox is written in the same flow as UserRegistered."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.infra.outbox import OutboxEvent
from cornerroom.kernel.events import USER_REGISTERED
from cornerroom.worker import drain_outbox


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_register_emits_user_registered_outbox(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": "outbox@example.com", "password": "password12", "display_name": "Box"},
    )
    assert response.status_code == 201

    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        rows = (
            await session.execute(
                select(OutboxEvent).where(OutboxEvent.event_type == USER_REGISTERED)
            )
        ).scalars().all()
        assert any(row.payload.get("payload", {}).get("email") == "outbox@example.com" for row in rows)
        assert all(row.status == "PENDING" for row in rows if row.event_type == USER_REGISTERED)

        published = await drain_outbox({})
        assert published >= 1
        await session.refresh(rows[0]) if False else None

    async with factory() as session:
        again = (
            await session.execute(
                select(OutboxEvent).where(
                    OutboxEvent.event_type == USER_REGISTERED,
                    OutboxEvent.status == "PUBLISHED",
                )
            )
        ).scalars().all()
        assert again
