"""Reusable EntitlementService. Streaming must call this; the player must not decide access."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import ENTITLEMENT_GRANTED, ENTITLEMENT_REVOKED, DomainEvent
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.kernel.ports import NotificationPort, NullNotificationPort
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.entitlements.domain.lifecycle import (
    ENTITLEMENT_SCOPES,
    ENTITLEMENT_TYPES,
    entitlement_transition_action,
    is_covering,
)
from cornerroom.modules.entitlements.domain.models import Entitlement


class EntitlementService:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
        notifications: NotificationPort | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.notifications = notifications or NullNotificationPort()

    async def _emit(
        self,
        ctx: AuthContext | None,
        *,
        event_type: str,
        aggregate_id: UUID,
        payload: dict[str, Any],
        organization_id: UUID | None = None,
    ) -> None:
        domain = DomainEvent(
            event_type=event_type,
            producer="entitlements",
            aggregate_type="Entitlement",
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id if ctx else None,
            organization_id=organization_id,
            correlation_id=ctx.request_id if ctx else None,
        )
        await enqueue_outbox(self.session, domain)

    async def grant(
        self,
        ctx: AuthContext | None,
        *,
        user_id: UUID,
        entitlement_type: str,
        ref_id: UUID,
        scope: str = "TRACK",
        expires_at: datetime | None = None,
        source_type: str | None = None,
        source_id: UUID | None = None,
        organization_id: UUID | None = None,
        actor_id: UUID | None = None,
    ) -> tuple[Entitlement, bool]:
        if entitlement_type not in ENTITLEMENT_TYPES:
            raise AppError("VALIDATION_ERROR", "Unknown entitlement type", 422)
        if scope not in ENTITLEMENT_SCOPES:
            raise AppError("VALIDATION_ERROR", "Unknown entitlement scope", 422)
        existing_q = select(Entitlement).where(
            Entitlement.user_id == user_id,
            Entitlement.entitlement_type == entitlement_type,
            Entitlement.ref_id == ref_id,
            Entitlement.deleted_at.is_(None),
        )
        if source_id is not None:
            existing_q = existing_q.where(Entitlement.source_id == source_id)
        existing = (await self.session.execute(existing_q)).scalars().first()
        if existing is not None and existing.status == "ACTIVE":
            return existing, False
        if existing is not None and existing.status != "ACTIVE":
            existing.status = "ACTIVE"
            existing.scope = scope
            existing.expires_at = expires_at
            existing.source_type = source_type
            existing.source_id = source_id
            existing.updated_by = actor_id or (ctx.user_id if ctx else None)
            await self.session.flush()
            await self._after_grant(ctx, existing, organization_id=organization_id, replayed=False)
            return existing, True
        row = Entitlement(
            user_id=user_id,
            entitlement_type=entitlement_type,
            ref_id=ref_id,
            scope=scope,
            status="ACTIVE",
            expires_at=expires_at,
            source_type=source_type,
            source_id=source_id,
            created_by=actor_id or (ctx.user_id if ctx else None),
            updated_by=actor_id or (ctx.user_id if ctx else None),
        )
        self.session.add(row)
        try:
            async with self.session.begin_nested():
                await self.session.flush()
        except IntegrityError:
            replay = (await self.session.execute(existing_q)).scalars().first()
            if replay is None:
                raise
            return replay, False
        await self._after_grant(ctx, row, organization_id=organization_id, replayed=False)
        return row, True

    async def _after_grant(
        self,
        ctx: AuthContext | None,
        row: Entitlement,
        *,
        organization_id: UUID | None,
        replayed: bool,
    ) -> None:
        del replayed
        await self._emit(
            ctx,
            event_type=ENTITLEMENT_GRANTED,
            aggregate_id=row.id,
            organization_id=organization_id,
            payload={
                "entitlement_id": str(row.id),
                "user_id": str(row.user_id),
                "entitlement_type": row.entitlement_type,
                "ref_id": str(row.ref_id),
                "scope": row.scope,
                "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            },
        )
        if ctx is not None:
            await self.audit.record_from_auth(
                ctx,
                action="entitlement.granted",
                entity_type="Entitlement",
                entity_id=row.id,
                new_state={
                    "status": row.status,
                    "entitlement_type": row.entitlement_type,
                    "scope": row.scope,
                },
                organization_id=organization_id,
            )
        else:
            await self.audit.record(
                action="entitlement.granted",
                entity_type="Entitlement",
                entity_id=row.id,
                actor_id="system:commerce",
                actor_type="system",
                new_state={"status": row.status, "entitlement_type": row.entitlement_type},
                organization_id=organization_id,
            )
        await self.notifications.request(
            user_id=row.user_id,
            notification_type="entitlement.granted",
            title="Entitlement granted",
            body="A commercial entitlement is now active on your account.",
        )

    async def revoke(
        self,
        ctx: AuthContext | None,
        entitlement_id: UUID,
        *,
        organization_id: UUID | None = None,
    ) -> Entitlement:
        row = await self.session.get(Entitlement, entitlement_id)
        if row is None or row.deleted_at is not None:
            raise NotFoundError("Entitlement not found")
        if row.status == "REVOKED":
            return row
        entitlement_transition_action(row.status, "REVOKED")
        row.status = "REVOKED"
        row.updated_by = ctx.user_id if ctx else None
        await self.session.flush()
        await self._emit(
            ctx,
            event_type=ENTITLEMENT_REVOKED,
            aggregate_id=row.id,
            organization_id=organization_id,
            payload={
                "entitlement_id": str(row.id),
                "user_id": str(row.user_id),
                "entitlement_type": row.entitlement_type,
                "ref_id": str(row.ref_id),
            },
        )
        if ctx is not None:
            await self.audit.record_from_auth(
                ctx,
                action="entitlement.revoked",
                entity_type="Entitlement",
                entity_id=row.id,
                new_state={"status": row.status},
                organization_id=organization_id,
            )
        return row

    async def has_catalog_access(self, user_id: UUID, track_id: UUID) -> bool:
        now = self.clock.now()
        stmt = select(Entitlement).where(
            Entitlement.user_id == user_id,
            Entitlement.status == "ACTIVE",
            Entitlement.deleted_at.is_(None),
        )
        rows = list((await self.session.execute(stmt)).scalars())
        for row in rows:
            expires = row.expires_at
            if is_covering(
                status=row.status,
                scope=row.scope,
                ref_id=row.ref_id,
                track_id=track_id,
                expires_at=expires,
                now=now,
            ):
                return True
        return False

    async def require_catalog_access(self, user_id: UUID, track_id: UUID) -> None:
        if not await self.has_catalog_access(user_id, track_id):
            raise AppError(
                "ENTITLEMENT_REQUIRED",
                "Commercial entitlement is required to play this track",
                403,
                "Playback is Catalog Playability THEN Entitlement THEN Audio Delivery. "
                "No free tier is invented (Q-P9-04 / Q-P8-09).",
            )

    async def list_for_user(
        self,
        user_id: UUID,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[Entitlement], str | None]:
        limit = clamp_limit(limit)
        stmt = (
            select(Entitlement)
            .where(Entitlement.user_id == user_id, Entitlement.deleted_at.is_(None))
            .order_by(Entitlement.created_at.desc(), Entitlement.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(Entitlement.created_at < data["t"])
        rows = list((await self.session.execute(stmt.limit(limit + 1))).scalars())
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:limit]
        return rows, next_cursor

    async def get_own(self, user_id: UUID, entitlement_id: UUID) -> Entitlement:
        row = await self.session.get(Entitlement, entitlement_id)
        if row is None or row.deleted_at is not None or row.user_id != user_id:
            raise NotFoundError("Entitlement not found")
        return row

    async def find_active_for_source(
        self,
        *,
        user_id: UUID,
        source_id: UUID,
    ) -> list[Entitlement]:
        stmt = select(Entitlement).where(
            Entitlement.user_id == user_id,
            Entitlement.source_id == source_id,
            Entitlement.status == "ACTIVE",
            Entitlement.deleted_at.is_(None),
        )
        return list((await self.session.execute(stmt)).scalars())
