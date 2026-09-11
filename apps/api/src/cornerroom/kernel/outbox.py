"""Outbox port. Postgres table is the source of truth; the broker is not."""

from __future__ import annotations

from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.kernel.events import DomainEvent


class OutboxWriter(Protocol):
    async def record(self, session: AsyncSession, event: DomainEvent) -> None: ...


class InProcessEventBus:
    """After-commit in-process handlers. Failures must not roll back the domain tx."""

    def __init__(self) -> None:
        self._handlers: dict[str, list] = {}

    def subscribe(self, event_type: str, handler) -> None:
        self._handlers.setdefault(event_type, []).append(handler)

    async def publish(self, event: DomainEvent) -> None:
        for handler in self._handlers.get(event.event_type, []):
            await handler(event)
        for handler in self._handlers.get("*", []):
            await handler(event)


event_bus = InProcessEventBus()
