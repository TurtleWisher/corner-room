"""Resolve a single recipient from an existing event. No org-member or follower fan-out."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import NotFoundError
from cornerroom.kernel.events import (
    ACCOUNT_LOCKED,
    CAMPAIGN_TASK_ASSIGNED,
    CAMPAIGN_TASK_COMPLETED,
    DomainEvent,
    ENTITLEMENT_GRANTED,
    ORDER_PAID,
    ORGANIZATION_INVITATION_ISSUED,
    PASSWORD_CHANGED,
    PAYMENT_FAILED,
    PAYOUT_COMPLETED,
    PAYOUT_FAILED,
    REFRESH_TOKEN_REPLAY_DETECTED,
    ROYALTY_STATEMENT_ADJUSTED,
    ROYALTY_STATEMENT_ISSUED,
    SETTLEMENT_COMPLETED,
    SUBSCRIPTION_CANCELLED,
    SUBSCRIPTION_PAST_DUE,
    SUBSCRIPTION_STARTED,
    TRACK_APPROVED,
    TRACK_RELEASED,
    USER_REGISTERED,
)
from cornerroom.modules.notifications.domain.policy import TICKET_ISSUED


def _uuid(value: object | None) -> UUID | None:
    if value is None or value == "":
        return None
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except (TypeError, ValueError):
        return None


async def resolve_recipient(session: AsyncSession, event: DomainEvent) -> UUID | None:
    """Return a user id from payload/aggregate identity, or None to skip."""
    payload = event.payload or {}
    event_type = event.event_type

    if event_type == USER_REGISTERED:
        return event.aggregate_id
    if event_type in {PASSWORD_CHANGED, ACCOUNT_LOCKED}:
        return event.aggregate_id
    if event_type == REFRESH_TOKEN_REPLAY_DETECTED:
        return event.actor_id
    if event_type == ORGANIZATION_INVITATION_ISSUED:
        return _uuid(payload.get("invited_user_id"))
    if event_type in {CAMPAIGN_TASK_ASSIGNED, CAMPAIGN_TASK_COMPLETED}:
        return _uuid(payload.get("assignee_user_id"))
    if event_type == ENTITLEMENT_GRANTED:
        return _uuid(payload.get("user_id"))

    if event_type == TICKET_ISSUED:
        ticket_id = _uuid(payload.get("ticket_id")) or event.aggregate_id
        from cornerroom.modules.ticketing.application.service import TicketingService

        try:
            ticket = await TicketingService(session).get_ticket_row(ticket_id)
        except NotFoundError:
            return None
        return ticket.owner_user_id

    if event_type == ORDER_PAID:
        order_id = _uuid(payload.get("order_id")) or event.aggregate_id
        from cornerroom.modules.commerce.application.service import CheckoutService

        try:
            order = await CheckoutService(session).get_order_row(order_id)
        except NotFoundError:
            return None
        return order.user_id

    if event_type == PAYMENT_FAILED:
        payment_id = _uuid(payload.get("payment_id")) or event.aggregate_id
        from cornerroom.modules.finance.application.service import PaymentService

        try:
            payment = await PaymentService(session).get_payment(payment_id)
        except NotFoundError:
            return None
        return payment.user_id

    if event_type in {TRACK_APPROVED, TRACK_RELEASED}:
        from cornerroom.modules.artists.application.service import ArtistService
        from cornerroom.modules.music.application.service import MusicService

        try:
            track = await MusicService(session).get_track_row(event.aggregate_id)
        except NotFoundError:
            return None
        if track.primary_artist_id is None:
            return None
        try:
            artist = await ArtistService(session).get_artist_row(track.primary_artist_id)
        except NotFoundError:
            return None
        return artist.claimed_user_id

    if event_type in {SUBSCRIPTION_STARTED, SUBSCRIPTION_PAST_DUE, SUBSCRIPTION_CANCELLED}:
        sub_id = _uuid(payload.get("subscription_id")) or event.aggregate_id
        from cornerroom.modules.subscriptions.application.service import SubscriptionService

        try:
            sub = await SubscriptionService(session).get_subscription_row(sub_id)
        except NotFoundError:
            return None
        return sub.user_id

    if event_type in {ROYALTY_STATEMENT_ISSUED, ROYALTY_STATEMENT_ADJUSTED}:
        return await _payee_user(
            session,
            payload.get("payee_type"),
            _uuid(payload.get("payee_id")),
        )

    if event_type in {SETTLEMENT_COMPLETED, PAYOUT_COMPLETED, PAYOUT_FAILED}:
        return await _payout_or_settlement_user(session, event)

    return None


async def _payee_user(session: AsyncSession, payee_type: object, payee_id: UUID | None) -> UUID | None:
    if payee_id is None:
        return None
    if payee_type == "USER":
        return payee_id
    if payee_type == "ARTIST":
        from cornerroom.modules.artists.application.service import ArtistService

        try:
            artist = await ArtistService(session).get_artist_row(payee_id)
        except NotFoundError:
            return None
        return artist.claimed_user_id
    # ORGANIZATION → do not fan out to members (Q-P13-04).
    return None


async def _payout_or_settlement_user(session: AsyncSession, event: DomainEvent) -> UUID | None:
    payload = event.payload or {}
    from cornerroom.modules.finance.application.payout import PayoutService
    from cornerroom.modules.royalties.application.service import RoyaltyService

    settlement_id = _uuid(payload.get("settlement_id"))
    payout_id = _uuid(payload.get("payout_id")) or (
        event.aggregate_id if event.aggregate_type == "Payout" else None
    )
    if settlement_id is None and event.aggregate_type == "Settlement":
        settlement_id = event.aggregate_id
    royalties = RoyaltyService(session)
    if settlement_id is None and payout_id is not None:
        try:
            payout = await PayoutService(session).get_payout_row(payout_id)
        except NotFoundError:
            payout = None
        if payout is not None:
            settlement_id = payout.settlement_id
    if settlement_id is None:
        return None
    try:
        settlement = await royalties.get_settlement_row(settlement_id)
    except NotFoundError:
        return None
    return await _payee_user(session, settlement.payee_type, settlement.payee_id)
