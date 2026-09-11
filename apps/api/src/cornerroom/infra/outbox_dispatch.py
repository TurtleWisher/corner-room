"""Outbox dispatch registry. Domain modules register handlers; unknown types no-op."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.outbox import OutboxEvent
from cornerroom.kernel.events import ORGANIZATION_INVITATION_ISSUED, USER_REGISTERED, DomainEvent
from cornerroom.modules.notifications.application.service import (
    handle_organization_invitation_issued,
    handle_user_registered,
)

log = structlog.get_logger("outbox.dispatch")

OutboxHandler = Callable[[DomainEvent, AsyncSession], Awaitable[None]]

HANDLERS: dict[str, OutboxHandler] = {
    USER_REGISTERED: handle_user_registered,
    ORGANIZATION_INVITATION_ISSUED: handle_organization_invitation_issued,
}


def register_handler(event_type: str, handler: OutboxHandler) -> None:
    HANDLERS[event_type] = handler


def event_from_outbox(row: OutboxEvent) -> DomainEvent:
    payload = row.payload or {}
    inner = payload.get("payload") or {}
    raw_id = payload.get("aggregate_id") or row.aggregate_id or row.id
    aggregate_id = raw_id if isinstance(raw_id, UUID) else UUID(str(raw_id))
    return DomainEvent(
        event_id=row.id,
        event_type=row.event_type,
        producer=payload.get("producer") or "unknown",
        aggregate_type=payload.get("aggregate_type") or row.aggregate_type or "Unknown",
        aggregate_id=aggregate_id,
        payload=inner,
        occurred_at=row.occurred_at,
        correlation_id=row.correlation_id or payload.get("correlation_id"),
        causation_id=payload.get("causation_id"),
    )


async def dispatch_outbox(session: AsyncSession, row: OutboxEvent) -> None:
    event = event_from_outbox(row)
    structlog.contextvars.bind_contextvars(
        correlation_id=event.correlation_id,
        event_type=event.event_type,
        event_id=str(event.event_id),
    )
    handler = HANDLERS.get(event.event_type)
    if handler is None:
        log.warning("outbox_no_handler", event_type=event.event_type)
        return
    await handler(event, session)
