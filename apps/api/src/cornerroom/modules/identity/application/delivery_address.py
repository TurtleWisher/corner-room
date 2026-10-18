"""The user's Bangladesh delivery address for gifts (D-ADDR-01).

Only the owner reads or changes it. It is personal data: the audit row records that it was saved,
never its contents, and nothing here logs it.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.identity.domain.bd_address import ADDRESS_FIELDS, clean_address
from cornerroom.modules.identity.domain.models import DeliveryAddress


class DeliveryAddressService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_for_user(self, user_id: UUID) -> DeliveryAddress | None:
        return (
            await self.session.execute(select(DeliveryAddress).where(DeliveryAddress.user_id == user_id))
        ).scalar_one_or_none()

    async def save(self, ctx: AuthContext, data: dict[str, object]) -> DeliveryAddress:
        cleaned = clean_address(data)
        row = await self.get_for_user(ctx.user_id)
        created = row is None
        if row is None:
            row = DeliveryAddress(user_id=ctx.user_id, **cleaned)
            self.session.add(row)
        else:
            for field in ADDRESS_FIELDS:
                setattr(row, field, cleaned[field])
        await self.session.flush()
        # Load the server-set timestamps now; reading them later would lazy-load outside async.
        await self.session.refresh(row)
        await AuditService(self.session).record_from_auth(
            ctx,
            action="delivery_address.saved",
            entity_type="DeliveryAddress",
            entity_id=row.id,
            # Never the address itself: only that it changed.
            new_state={"created": created},
        )
        return row
