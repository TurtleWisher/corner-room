"""Outbox dispatch registry. Domain modules register handlers; unknown types no-op.

Operational handlers (finance, streaming) stay one-per-type.
Notifications, search, and analytics run as independent side consumers so a
failure in one does not skip the others. OLTP is already committed.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from uuid import UUID

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.outbox import OutboxEvent
from cornerroom.kernel.events import DomainEvent
from cornerroom.modules.analytics.application.consumers import consume_analytics_event
from cornerroom.modules.notifications.application.consumers import consume_notification_event
from cornerroom.modules.search.application.consumers import consume_search_event

log = structlog.get_logger("outbox.dispatch")

OutboxHandler = Callable[[DomainEvent, AsyncSession], Awaitable[None]]

HANDLERS: dict[str, OutboxHandler] = {}

SIDE_CONSUMERS: list[OutboxHandler] = [
    consume_notification_event,
    consume_search_event,
    consume_analytics_event,
]


def register_handler(event_type: str, handler: OutboxHandler) -> None:
    HANDLERS[event_type] = handler


def register_side_consumer(handler: OutboxHandler) -> None:
    if handler not in SIDE_CONSUMERS:
        SIDE_CONSUMERS.append(handler)


def event_from_outbox(row: OutboxEvent) -> DomainEvent:
    payload = row.payload or {}
    inner = payload.get("payload") or {}
    raw_id = payload.get("aggregate_id") or row.aggregate_id or row.id
    aggregate_id = raw_id if isinstance(raw_id, UUID) else UUID(str(raw_id))
    actor_raw = payload.get("actor_id")
    org_raw = payload.get("organization_id")
    return DomainEvent(
        event_id=row.id,
        event_type=row.event_type,
        producer=payload.get("producer") or "unknown",
        aggregate_type=payload.get("aggregate_type") or row.aggregate_type or "Unknown",
        aggregate_id=aggregate_id,
        payload=inner,
        occurred_at=row.occurred_at,
        actor_id=UUID(str(actor_raw)) if actor_raw else None,
        organization_id=UUID(str(org_raw)) if org_raw else None,
        correlation_id=row.correlation_id or payload.get("correlation_id"),
        causation_id=payload.get("causation_id"),
        schema_version=int(payload.get("schema_version") or 1),
    )


async def dispatch_outbox(session: AsyncSession, row: OutboxEvent) -> None:
    event = event_from_outbox(row)
    structlog.contextvars.bind_contextvars(
        correlation_id=event.correlation_id,
        event_type=event.event_type,
        event_id=str(event.event_id),
    )
    errors: list[BaseException] = []
    handler = HANDLERS.get(event.event_type)
    if handler is not None:
        try:
            async with session.begin_nested():
                await handler(event, session)
        except Exception as exc:
            log.exception("outbox_handler_failed", event_type=event.event_type)
            errors.append(exc)
    for consumer in list(SIDE_CONSUMERS):
        try:
            async with session.begin_nested():
                await consumer(event, session)
        except Exception as exc:
            log.exception("outbox_side_consumer_failed", event_type=event.event_type)
            errors.append(exc)
    if handler is None and not SIDE_CONSUMERS:
        log.warning("outbox_no_handler", event_type=event.event_type)
        return
    if errors:
        raise errors[0]
