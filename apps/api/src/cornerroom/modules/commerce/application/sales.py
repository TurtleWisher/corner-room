"""Catalog sales read model: what fans paid for given songs and releases (HANDOFF 0.2 step 2).

Read-only, straight from the operational tables (orders, order lines, payments, refunds), never
from analytics. Only what was paid counts: an order is a sale once it reached PAID (later
FULFILLED or refunded). Refunds count when COMPLETED. No buyer identity ever leaves here, and no
share, fee or royalty is applied: what an artist earns comes from royalty statements.
"""

from __future__ import annotations

from collections.abc import Collection
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.kernel.pagination import clamp_limit, encode_cursor, keyset_before
from cornerroom.modules.commerce.domain.models import Order, OrderItem
from cornerroom.modules.finance.domain.models_payments import Payment, Refund

# Orders whose payment was taken. Later refunds keep the sale and show the refund beside it.
SOLD_ORDER_STATUSES = ("PAID", "FULFILLED", "PARTIALLY_REFUNDED", "REFUNDED")


class CatalogSales:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @staticmethod
    def _subjects(track_ids: Collection[UUID], release_ids: Collection[UUID]):
        parts = []
        if track_ids:
            parts.append(and_(OrderItem.item_type == "TRACK", OrderItem.ref_id.in_(list(track_ids))))
        if release_ids:
            parts.append(and_(OrderItem.item_type == "RELEASE", OrderItem.ref_id.in_(list(release_ids))))
        return or_(*parts) if parts else None

    @staticmethod
    def _refunded_by_order():
        """Completed refund money per order (refunds are additive rows on the order's payment)."""
        return (
            select(Payment.order_id.label("order_id"), func.sum(Refund.amount_minor).label("refunded"))
            .join(Refund, Refund.payment_id == Payment.id)
            .where(Refund.status == "COMPLETED", Payment.order_id.is_not(None))
            .group_by(Payment.order_id)
            .subquery()
        )

    def _sold(self, subjects: Any):
        refunded = self._refunded_by_order()
        stmt = (
            select(
                OrderItem.id,
                OrderItem.item_type,
                OrderItem.ref_id,
                OrderItem.quantity,
                OrderItem.amount_minor,
                OrderItem.currency_code,
                Order.status,
                Order.created_at,
                func.coalesce(refunded.c.refunded, 0).label("refunded"),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .outerjoin(refunded, refunded.c.order_id == Order.id)
            .where(subjects, Order.status.in_(SOLD_ORDER_STATUSES), Order.deleted_at.is_(None))
        )
        return stmt

    async def by_subject(
        self, track_ids: Collection[UUID], release_ids: Collection[UUID]
    ) -> list[dict[str, Any]]:
        """One row per (song or release, currency): units, paid, refunded, last sale."""
        subjects = self._subjects(track_ids, release_ids)
        if subjects is None:
            return []
        # Music orders carry one line, so the order's refunds belong to that line; cap them at the
        # line amount so a multi-line order could never show more refunded than paid.
        sold = self._sold(subjects).subquery()
        line_refund = func.least(sold.c.refunded, sold.c.amount_minor)
        rows = (
            await self.session.execute(
                select(
                    sold.c.item_type,
                    sold.c.ref_id,
                    sold.c.currency_code,
                    func.sum(sold.c.quantity).label("units"),
                    func.count().filter(sold.c.status == "REFUNDED").label("refunded_count"),
                    func.sum(sold.c.amount_minor).label("gross"),
                    func.sum(line_refund).label("refunded"),
                    func.max(sold.c.created_at).label("last_sold_at"),
                ).group_by(sold.c.item_type, sold.c.ref_id, sold.c.currency_code)
            )
        ).all()
        return [
            {
                "subject_type": r.item_type,
                "subject_id": r.ref_id,
                "currency_code": r.currency_code,
                "sold_count": int(r.units),
                "refunded_count": int(r.refunded_count),
                "gross_amount_minor": int(r.gross),
                "refunded_amount_minor": int(r.refunded),
                "net_amount_minor": int(r.gross) - int(r.refunded),
                "last_sold_at": r.last_sold_at,
            }
            for r in rows
        ]

    async def lines(
        self,
        track_ids: Collection[UUID],
        release_ids: Collection[UUID],
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Individual sales, newest first, without anything that identifies the buyer."""
        subjects = self._subjects(track_ids, release_ids)
        if subjects is None:
            return [], None
        size = clamp_limit(limit, default=20)
        stmt = self._sold(subjects)
        if cursor:
            stmt = stmt.where(keyset_before(Order.created_at, OrderItem.id, cursor))
        rows = (
            await self.session.execute(stmt.order_by(Order.created_at.desc(), OrderItem.id.desc()).limit(size + 1))
        ).all()
        page = rows[:size]
        next_cursor = None
        if len(rows) > size:
            last = page[-1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
        return [
            {
                "id": r.id,
                "subject_type": r.item_type,
                "subject_id": r.ref_id,
                "quantity": r.quantity,
                "amount_minor": r.amount_minor,
                "refunded_amount_minor": min(int(r.refunded), r.amount_minor),
                "currency_code": r.currency_code,
                "order_status": r.status,
                "ordered_at": r.created_at,
            }
            for r in page
        ], next_cursor

