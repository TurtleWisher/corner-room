"""Append-only audit writer. Same transaction as the domain write."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.pagination import decode_cursor, encode_cursor
from cornerroom.modules.audit.domain.models import AuditLog

FORBIDDEN_KEYS = {
    "password",
    "password_hash",
    "pan",
    "cvv",
    "qr_secret",
    "token",
    "refresh_token",
    "recovery_token",
    "verification_token",
    "access_token",
    "token_hash",
    "invite_token",
    "invitation_token",
    "presentation_token",
    "ticket_token",
    "signed_url",
    "audio_token",
    "delivery_token",
}


def _scrub(state: dict[str, Any] | None) -> dict[str, Any] | None:
    if state is None:
        return None
    return {k: v for k, v in state.items() if k.lower() not in FORBIDDEN_KEYS}


class AuditService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def record(
        self,
        *,
        action: str,
        entity_type: str,
        entity_id: str | UUID,
        actor_id: str,
        actor_type: str = "user",
        previous_state: dict[str, Any] | None = None,
        new_state: dict[str, Any] | None = None,
        reason: str | None = None,
        request_id: str | None = None,
        ip: str | None = None,
        user_agent: str | None = None,
        metadata: dict[str, Any] | None = None,
        organization_id: UUID | None = None,
        on_behalf_of_user_id: UUID | None = None,
    ) -> AuditLog:
        row = AuditLog(
            actor_id=str(actor_id),
            actor_type=actor_type,
            on_behalf_of_user_id=on_behalf_of_user_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            previous_state=_scrub(previous_state),
            new_state=_scrub(new_state),
            reason=reason,
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
            extra_metadata=metadata,
            organization_id=organization_id,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def record_from_auth(
        self,
        ctx: AuthContext | None,
        *,
        action: str,
        entity_type: str,
        entity_id: str | UUID,
        previous_state: dict[str, Any] | None = None,
        new_state: dict[str, Any] | None = None,
        reason: str | None = None,
        metadata: dict[str, Any] | None = None,
        actor_id: str | None = None,
        actor_type: str = "user",
        organization_id: UUID | None = None,
    ) -> AuditLog:
        return await self.record(
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            actor_id=actor_id or (str(ctx.user_id) if ctx else "system:unknown"),
            actor_type=actor_type if ctx is None else ctx.actor_type,
            previous_state=previous_state,
            new_state=new_state,
            reason=reason,
            request_id=ctx.request_id if ctx else None,
            ip=ctx.ip if ctx else None,
            user_agent=ctx.user_agent if ctx else None,
            metadata=metadata,
            organization_id=organization_id
            if organization_id is not None
            else (ctx.organization_id if ctx else None),
            on_behalf_of_user_id=ctx.on_behalf_of_user_id if ctx else None,
        )

    async def list_entries(
        self,
        *,
        entity_type: str | None = None,
        entity_id: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> tuple[list[AuditLog], str | None]:
        stmt: Select[tuple[AuditLog]] = select(AuditLog).order_by(
            AuditLog.occurred_at.desc(),
            AuditLog.id.desc(),
        )
        if entity_type:
            stmt = stmt.where(AuditLog.entity_type == entity_type)
        if entity_id:
            stmt = stmt.where(AuditLog.entity_id == entity_id)
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(AuditLog.occurred_at < data["t"])
        stmt = stmt.limit(limit + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = encode_cursor(last.occurred_at.isoformat(), last.id)
            rows = rows[:limit]
        return rows, next_cursor
