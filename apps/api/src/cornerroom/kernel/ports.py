"""Kernel extension ports. No business implementations in Phase 01."""

from __future__ import annotations

from typing import Any, Protocol
from uuid import UUID


class NotificationPort(Protocol):
    """Future notification module binds here. Core transactions must not call SMTP."""

    async def request(
        self,
        *,
        user_id: UUID,
        notification_type: str,
        title: str,
        body: str,
    ) -> None: ...


class AnalyticsPort(Protocol):
    """Future analytics ingest. Operational truth stays in PostgreSQL."""

    async def record(self, event_name: str, payload: dict[str, Any]) -> None: ...


class AudioDeliveryPort(Protocol):
    """Mint short-lived audio access. Never return unrestricted masters."""

    def mint(self, **kwargs: Any) -> Any: ...


class NullNotificationPort:
    async def request(
        self,
        *,
        user_id: UUID,
        notification_type: str,
        title: str,
        body: str,
    ) -> None:
        return None


class NullAnalyticsPort:
    async def record(self, event_name: str, payload: dict[str, Any]) -> None:
        return None
