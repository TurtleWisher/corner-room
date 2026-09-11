"""Event and venue application service. Controllers stay thin. No ticketing or finance math."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo, available_timezones

from sqlalchemy import Select, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from cornerroom.infra.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    ARTIST_WITHDRAWN_FROM_EVENT,
    EVENT_CANCELLED,
    EVENT_COMPLETED,
    EVENT_PLANNED,
    EVENT_POSTPONED,
    EVENT_PUBLISHED,
    EVENT_WENT_LIVE,
    LINEUP_CONFIRMED,
    TICKETING_CLOSED,
    TICKETING_OPENED,
    VENUE_BOOKING_CHANGED,
    DomainEvent,
)
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.events.domain.lifecycle import (
    FINANCE_DEPENDENT_ACTIONS,
    MUTABLE_VENUE_ASSIGN_STATUSES,
    PERMISSION_FOR_ACTION,
    PUBLIC_EVENT_STATUSES,
    PUBLIC_LINEUP_STATUSES,
    event_target_for_action,
    event_transition_action,
    lineup_target_for_action,
    lineup_transition_action,
    venue_target_for_action,
    venue_transition_action,
)
from cornerroom.modules.events.domain.models import Event, EventLineup, EventMilestone, Venue, VenueBooking
from cornerroom.modules.identity.domain.models import Organization

_TZ_NAMES = available_timezones()

EVENT_DOMAIN_EVENTS = {
    "PLANNED": EVENT_PLANNED,
    "PUBLISHED": EVENT_PUBLISHED,
    "TICKETING_OPEN": TICKETING_OPENED,
    "SALES_CLOSED": TICKETING_CLOSED,
    "LIVE": EVENT_WENT_LIVE,
    "COMPLETED": EVENT_COMPLETED,
    "CANCELLED": EVENT_CANCELLED,
    "POSTPONED": EVENT_POSTPONED,
}

MILESTONE_FOR_STATUS = {
    "DRAFT": "created",
    "PLANNED": "planned",
    "PUBLISHED": "published",
    "POSTPONED": "postponed",
    "CANCELLED": "cancelled",
    "LIVE": "went_live",
    "COMPLETED": "completed",
}


def _aware(value: datetime | None, *, field: str) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        raise AppError(
            "VALIDATION_ERROR",
            "Timestamps must be timezone-aware",
            422,
            f"{field} must include a timezone offset; do not assume a local zone",
        )
    return value


def _validate_timezone(name: str) -> str:
    trimmed = name.strip()
    if not trimmed or trimmed not in _TZ_NAMES:
        raise AppError("VALIDATION_ERROR", "Invalid timezone", 422, "Use an IANA timezone name")
    ZoneInfo(trimmed)
    return trimmed


def _validate_interval(starts_at: datetime | None, ends_at: datetime | None) -> None:
    if starts_at is not None and ends_at is not None and ends_at <= starts_at:
        raise AppError("VALIDATION_ERROR", "Invalid schedule", 422, "end_at must be after start_at")


class EventService:
    def __init__(self, session: AsyncSession, clock: Clock | None = None) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)

    async def _org(self, org_id: UUID) -> Organization:
        org = await self.session.get(Organization, org_id)
        if org is None or org.deleted_at is not None:
            raise NotFoundError("Organization not found")
        return org

    async def _require_active_org(self, org_id: UUID) -> Organization:
        org = await self._org(org_id)
        if org.status != "ACTIVE":
            raise AppError(
                "ORG_NOT_ACTIVE",
                "Organization is not active",
                409,
                "Suspended or archived organizations cannot mutate events or venues",
            )
        return org

    async def _is_allowed(
        self,
        user_id: UUID,
        permission: str,
        *,
        resource_type: str,
        resource_id: UUID,
        organization_id: UUID,
    ) -> bool:
        try:
            await self.authz.authorize(
                user_id,
                permission,
                resource_type=resource_type,
                resource_id=resource_id,
                scope_organization_id=organization_id,
            )
            return True
        except ForbiddenError:
            return False

    async def _assert_event_perm(
        self,
        ctx: AuthContext,
        event: Event,
        permission: str,
        *,
        mutate: bool,
    ) -> None:
        allowed = await self._is_allowed(
            ctx.user_id,
            permission,
            resource_type="event",
            resource_id=event.id,
            organization_id=event.organization_id,
        )
        if allowed:
            return
        can_read = await self._is_allowed(
            ctx.user_id,
            "event.read",
            resource_type="event",
            resource_id=event.id,
            organization_id=event.organization_id,
        )
        if mutate and can_read:
            raise ForbiddenError(f"Missing permission {permission}")
        raise NotFoundError("Event not found")

    async def _assert_venue_perm(
        self,
        ctx: AuthContext,
        venue: Venue,
        permission: str,
        *,
        mutate: bool,
    ) -> None:
        allowed = await self._is_allowed(
            ctx.user_id,
            permission,
            resource_type="venue",
            resource_id=venue.id,
            organization_id=venue.organization_id,
        )
        if allowed:
            return
        can_read = await self._is_allowed(
            ctx.user_id,
            "venue.read",
            resource_type="venue",
            resource_id=venue.id,
            organization_id=venue.organization_id,
        )
        if mutate and can_read:
            raise ForbiddenError(f"Missing permission {permission}")
        raise NotFoundError("Venue not found")

    def _workspace_org_id(self, ctx: AuthContext, claimed: UUID | None) -> UUID:
        if claimed is not None and ctx.organization_id is not None and claimed != ctx.organization_id:
            raise AppError(
                "ORG_SCOPE_MISMATCH",
                "Organization scope mismatch",
                403,
                "Client organization_id cannot override the authorized workspace",
            )
        org_id = ctx.organization_id
        if org_id is None:
            raise ForbiddenError("Switch to an organization workspace before mutating events or venues")
        if claimed is not None:
            return claimed
        return org_id

    async def _emit(
        self,
        ctx: AuthContext,
        *,
        event_type: str,
        aggregate_type: str,
        aggregate_id: UUID,
        organization_id: UUID,
        payload: dict[str, Any],
    ) -> None:
        domain = DomainEvent(
            event_type=event_type,
            producer="events",
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, domain)

    async def _milestone(
        self,
        event: Event,
        *,
        milestone_type: str,
        ctx: AuthContext,
        previous: str | None,
        new_state: str | None,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        row = EventMilestone(
            event_id=event.id,
            type=milestone_type,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            previous_state=previous,
            new_state=new_state,
            description=description,
            extra_metadata=metadata,
        )
        self.session.add(row)
        await self.session.flush()

    async def _flush_versioned(self) -> None:
        try:
            await self.session.flush()
        except StaleDataError as exc:
            raise ConflictError("The resource was updated concurrently") from exc

    def _is_public(self, event: Event) -> bool:
        return event.published_at is not None and event.status in PUBLIC_EVENT_STATUSES

    async def get_event_row(self, event_id: UUID) -> Event:
        event = await self.session.get(Event, event_id)
        if event is None or event.deleted_at is not None:
            raise NotFoundError("Event not found")
        return event

    async def get_venue_row(self, venue_id: UUID) -> Venue:
        venue = await self.session.get(Venue, venue_id)
        if venue is None or venue.deleted_at is not None:
            raise NotFoundError("Venue not found")
        return venue

    async def create_event(
        self,
        ctx: AuthContext,
        *,
        title: str,
        timezone: str,
        description: str | None = None,
        starts_at: datetime | None = None,
        ends_at: datetime | None = None,
        organization_id: UUID | None = None,
        extra_metadata: dict[str, Any] | None = None,
    ) -> Event:
        org_id = self._workspace_org_id(ctx, organization_id)
        await self._require_active_org(org_id)
        allowed = await self._is_allowed(
            ctx.user_id,
            "event.write",
            resource_type="event",
            resource_id=org_id,
            organization_id=org_id,
        )
        if not allowed:
            raise ForbiddenError("Missing permission event.write")
        starts = _aware(starts_at, field="starts_at")
        ends = _aware(ends_at, field="ends_at")
        _validate_interval(starts, ends)
        event = Event(
            organization_id=org_id,
            title=title.strip(),
            description=description.strip() if description else None,
            timezone=_validate_timezone(timezone),
            starts_at=starts,
            ends_at=ends,
            status="DRAFT",
            extra_metadata=extra_metadata,
            created_by=ctx.user_id,
        )
        self.session.add(event)
        await self.session.flush()
        await self._milestone(
            event,
            milestone_type="created",
            ctx=ctx,
            previous=None,
            new_state="DRAFT",
        )
        await self.audit.record_from_auth(
            ctx,
            action="event.created",
            entity_type="Event",
            entity_id=event.id,
            new_state={"title": event.title, "status": event.status, "organization_id": str(org_id)},
            organization_id=org_id,
        )
        return event

    async def get_event(self, event_id: UUID, ctx: AuthContext | None) -> tuple[Event, bool]:
        event = await self.get_event_row(event_id)
        public = self._is_public(event)
        if ctx is None:
            if not public:
                raise NotFoundError("Event not found")
            return event, True
        can_read = await self._is_allowed(
            ctx.user_id,
            "event.read",
            resource_type="event",
            resource_id=event.id,
            organization_id=event.organization_id,
        )
        if can_read:
            return event, False
        if public:
            return event, True
        raise NotFoundError("Event not found")

    async def list_events(
        self,
        ctx: AuthContext | None,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[Event], str | None, bool]:
        page = clamp_limit(limit)
        stmt: Select[tuple[Event]] = select(Event).where(Event.deleted_at.is_(None))
        public_only = True
        if ctx is not None and ctx.organization_id is not None:
            can_read = await self._is_allowed(
                ctx.user_id,
                "event.read",
                resource_type="event",
                resource_id=ctx.organization_id,
                organization_id=ctx.organization_id,
            )
            if can_read:
                public_only = False
                stmt = stmt.where(Event.organization_id == ctx.organization_id)
        if public_only:
            stmt = stmt.where(
                Event.published_at.is_not(None),
                Event.status.in_(tuple(PUBLIC_EVENT_STATUSES)),
            )
        stmt = stmt.order_by(Event.created_at.desc(), Event.id.desc())
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(Event.created_at < data["t"])
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor, public_only

    async def update_event(
        self,
        ctx: AuthContext,
        event_id: UUID,
        *,
        title: str | None = None,
        description: str | None = ...,  # type: ignore[assignment]
        timezone: str | None = None,
        starts_at: datetime | None = ...,  # type: ignore[assignment]
        ends_at: datetime | None = ...,  # type: ignore[assignment]
        expected_version: int | None = None,
        extra_metadata: dict[str, Any] | None = ...,  # type: ignore[assignment]
    ) -> Event:
        event = await self.get_event_row(event_id)
        await self._assert_event_perm(ctx, event, "event.write", mutate=True)
        await self._require_active_org(event.organization_id)
        if event.status in {"ARCHIVED", "CANCELLED", "SETTLED"}:
            raise AppError("INVALID_TRANSITION", "Event cannot be edited in this state", 409)
        if expected_version is not None and event.version != expected_version:
            raise ConflictError("Event version conflict")
        previous = {"title": event.title, "status": event.status, "version": event.version}
        if title is not None:
            event.title = title.strip()
        if description is not ...:
            event.description = description.strip() if description else None
        if timezone is not None:
            event.timezone = _validate_timezone(timezone)
        if starts_at is not ...:
            event.starts_at = _aware(starts_at, field="starts_at")
        if ends_at is not ...:
            event.ends_at = _aware(ends_at, field="ends_at")
        _validate_interval(event.starts_at, event.ends_at)
        if extra_metadata is not ...:
            event.extra_metadata = extra_metadata
        event.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action="event.updated",
            entity_type="Event",
            entity_id=event.id,
            previous_state=previous,
            new_state={"title": event.title, "version": event.version},
            organization_id=event.organization_id,
        )
        return event

    async def transition_event(
        self,
        ctx: AuthContext,
        event_id: UUID,
        *,
        action: str,
        starts_at: datetime | None = None,
        ends_at: datetime | None = None,
        reason: str | None = None,
        resume_status: str | None = None,
        expected_version: int | None = None,
    ) -> Event:
        event = await self.get_event_row(event_id)
        permission = PERMISSION_FOR_ACTION.get(action)
        if permission is None:
            raise AppError("VALIDATION_ERROR", "Unknown lifecycle action", 422)
        await self._assert_event_perm(ctx, event, permission, mutate=True)
        await self._require_active_org(event.organization_id)
        if expected_version is not None and event.version != expected_version:
            raise ConflictError("Event version conflict")

        if action == "open_ticketing":
            from cornerroom.modules.ticketing.application.queries import has_on_sale_ticket_type

            if not await has_on_sale_ticket_type(self.session, event.id):
                raise AppError(
                    "TICKETING_REQUIRED",
                    "Ticketing cannot open",
                    409,
                    "PUBLISHED → TICKETING_OPEN requires ≥1 TicketType ON_SALE.",
                )
        if action in FINANCE_DEPENDENT_ACTIONS:
            raise AppError(
                "FINANCE_REQUIRED",
                "Settlement is a Finance process",
                409,
                "COMPLETED → SETTLED is not an Event Manager toggle.",
            )

        previous = event.status
        if action == "cancel":
            target = "CANCELLED"
            event_transition_action(previous, target)
        elif action == "resume":
            target = resume_status or event.resume_status
            if target is None:
                raise AppError("VALIDATION_ERROR", "resume_status is required", 422)
            event_transition_action(previous, target)
        else:
            target = event_target_for_action(action)
            if target is None:
                raise AppError("VALIDATION_ERROR", "Unknown lifecycle action", 422)
            event_transition_action(previous, target)

        if action == "plan":
            if not event.title.strip():
                raise AppError("VALIDATION_ERROR", "Title is required", 422)
            if event.starts_at is None:
                raise AppError("VALIDATION_ERROR", "starts_at is required to plan", 422)
            _validate_interval(event.starts_at, event.ends_at)
        if action == "publish":
            if not event.title.strip() or not (event.description or "").strip():
                raise AppError(
                    "VALIDATION_ERROR",
                    "Public copy is required",
                    422,
                    "Publication requires title and description (architecture public copy).",
                )
            if event.starts_at is None:
                raise AppError("VALIDATION_ERROR", "starts_at is required to publish", 422)
        if action == "postpone":
            new_start = _aware(starts_at, field="starts_at")
            new_end = _aware(ends_at, field="ends_at") if ends_at is not None else event.ends_at
            if new_start is None:
                raise AppError("VALIDATION_ERROR", "starts_at is required to postpone", 422)
            _validate_interval(new_start, new_end)
            event.previous_starts_at = event.starts_at
            event.previous_ends_at = event.ends_at
            event.resume_status = previous
            event.starts_at = new_start
            event.ends_at = new_end
            event.postponed_at = self.clock.now()
            event.postponement_reason = reason
        if action == "cancel":
            event.cancelled_at = self.clock.now()
            event.cancellation_reason = reason
        if action == "publish":
            event.published_at = event.published_at or self.clock.now()
        if action == "resume" and event.previous_starts_at is not None and starts_at is None:
            pass

        event.status = target
        event.updated_by = ctx.user_id
        await self._flush_versioned()

        domain_type = EVENT_DOMAIN_EVENTS.get(target) if action != "resume" else None
        if domain_type:
            await self._emit(
                ctx,
                event_type=domain_type,
                aggregate_type="Event",
                aggregate_id=event.id,
                organization_id=event.organization_id,
                payload={
                    "event_id": str(event.id),
                    "previous_status": previous,
                    "status": event.status,
                },
            )
        milestone_type = MILESTONE_FOR_STATUS.get(target)
        if milestone_type:
            await self._milestone(
                event,
                milestone_type=milestone_type,
                ctx=ctx,
                previous=previous,
                new_state=event.status,
                description=reason,
            )
        await self.audit.record_from_auth(
            ctx,
            action=f"event.{action}",
            entity_type="Event",
            entity_id=event.id,
            previous_state={"status": previous},
            new_state={"status": event.status},
            organization_id=event.organization_id,
        )
        return event

    async def assign_venue(
        self,
        ctx: AuthContext,
        event_id: UUID,
        *,
        venue_id: UUID | None,
        expected_version: int | None = None,
    ) -> Event:
        event = await self.get_event_row(event_id)
        await self._assert_event_perm(ctx, event, "event.write", mutate=True)
        await self._require_active_org(event.organization_id)
        if event.status not in MUTABLE_VENUE_ASSIGN_STATUSES:
            raise AppError("INVALID_TRANSITION", "Venue cannot be changed in this state", 409)
        if expected_version is not None and event.version != expected_version:
            raise ConflictError("Event version conflict")
        if event.starts_at is None or event.ends_at is None:
            raise AppError(
                "VALIDATION_ERROR",
                "Schedule required",
                422,
                "Assigning a venue requires starts_at and ends_at for the booking interval",
            )
        _validate_interval(event.starts_at, event.ends_at)

        previous_venue = str(event.venue_id) if event.venue_id else None
        if venue_id is None:
            await self._cancel_active_booking(event, ctx)
            event.venue_id = None
        else:
            venue = await self.get_venue_row(venue_id)
            if venue.organization_id != event.organization_id:
                raise NotFoundError("Venue not found")
            if venue.status != "ACTIVE":
                raise AppError(
                    "INVALID_TRANSITION",
                    "Venue is not active",
                    409,
                    "Inactive or draft venues cannot be assigned",
                )
            await self._cancel_active_booking(event, ctx)
            booking = VenueBooking(
                venue_id=venue.id,
                event_id=event.id,
                starts_at=event.starts_at,
                ends_at=event.ends_at,
                status="CONFIRMED",
                quoted_amount_minor=None,
                currency_code=None,
                created_by=ctx.user_id,
            )
            self.session.add(booking)
            event.venue_id = venue.id
            await self.session.flush()
            await self._emit(
                ctx,
                event_type=VENUE_BOOKING_CHANGED,
                aggregate_type="VenueBooking",
                aggregate_id=booking.id,
                organization_id=event.organization_id,
                payload={
                    "booking_id": str(booking.id),
                    "event_id": str(event.id),
                    "venue_id": str(venue.id),
                    "status": "CONFIRMED",
                },
            )
            await self._milestone(
                event,
                milestone_type="venue_confirmed",
                ctx=ctx,
                previous=event.status,
                new_state=event.status,
                metadata={"venue_id": str(venue.id)},
            )

        event.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action="event.venue_assigned",
            entity_type="Event",
            entity_id=event.id,
            previous_state={"venue_id": previous_venue},
            new_state={"venue_id": str(event.venue_id) if event.venue_id else None},
            organization_id=event.organization_id,
        )
        return event

    async def _cancel_active_booking(self, event: Event, ctx: AuthContext) -> None:
        stmt = select(VenueBooking).where(
            VenueBooking.event_id == event.id,
            VenueBooking.status == "CONFIRMED",
            VenueBooking.deleted_at.is_(None),
        )
        rows = list((await self.session.execute(stmt)).scalars().all())
        for booking in rows:
            booking.status = "CANCELLED"
            booking.updated_by = ctx.user_id
            await self._emit(
                ctx,
                event_type=VENUE_BOOKING_CHANGED,
                aggregate_type="VenueBooking",
                aggregate_id=booking.id,
                organization_id=event.organization_id,
                payload={
                    "booking_id": str(booking.id),
                    "event_id": str(event.id),
                    "venue_id": str(booking.venue_id),
                    "status": "CANCELLED",
                },
            )

    async def list_milestones(
        self,
        ctx: AuthContext | None,
        event_id: UUID,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[EventMilestone], str | None]:
        event, public_view = await self.get_event(event_id, ctx)
        if public_view:
            raise NotFoundError("Event not found")
        page = clamp_limit(limit)
        stmt = (
            select(EventMilestone)
            .where(EventMilestone.event_id == event.id)
            .order_by(EventMilestone.occurred_at.desc(), EventMilestone.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(EventMilestone.occurred_at < data["t"])
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.occurred_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor

    async def create_venue(
        self,
        ctx: AuthContext,
        *,
        name: str,
        capacity: int = 0,
        address: dict[str, Any] | None = None,
        organization_id: UUID | None = None,
        extra_metadata: dict[str, Any] | None = None,
    ) -> Venue:
        org_id = self._workspace_org_id(ctx, organization_id)
        await self._require_active_org(org_id)
        allowed = await self._is_allowed(
            ctx.user_id,
            "venue.write",
            resource_type="venue",
            resource_id=org_id,
            organization_id=org_id,
        )
        if not allowed:
            raise ForbiddenError("Missing permission venue.write")
        if capacity < 0:
            raise AppError("VALIDATION_ERROR", "capacity must be >= 0", 422)
        venue = Venue(
            organization_id=org_id,
            name=name.strip(),
            capacity=capacity,
            address=address,
            status="DRAFT",
            extra_metadata=extra_metadata,
            created_by=ctx.user_id,
        )
        self.session.add(venue)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="venue.created",
            entity_type="Venue",
            entity_id=venue.id,
            new_state={"name": venue.name, "status": venue.status, "capacity": venue.capacity},
            organization_id=org_id,
        )
        return venue

    async def get_venue(self, venue_id: UUID, ctx: AuthContext) -> Venue:
        venue = await self.get_venue_row(venue_id)
        await self._assert_venue_perm(ctx, venue, "venue.read", mutate=False)
        return venue

    async def list_venues(
        self,
        ctx: AuthContext,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[Venue], str | None]:
        if ctx.organization_id is None:
            raise ForbiddenError("Switch to an organization workspace before listing venues")
        can_read = await self._is_allowed(
            ctx.user_id,
            "venue.read",
            resource_type="venue",
            resource_id=ctx.organization_id,
            organization_id=ctx.organization_id,
        )
        if not can_read:
            raise ForbiddenError("Missing permission venue.read")
        page = clamp_limit(limit)
        stmt: Select[tuple[Venue]] = select(Venue).where(
            Venue.deleted_at.is_(None),
            Venue.organization_id == ctx.organization_id,
        )
        stmt = stmt.order_by(Venue.created_at.desc(), Venue.id.desc())
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(Venue.created_at < data["t"])
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor

    async def update_venue(
        self,
        ctx: AuthContext,
        venue_id: UUID,
        *,
        name: str | None = None,
        capacity: int | None = None,
        address: dict[str, Any] | None = ...,  # type: ignore[assignment]
        expected_version: int | None = None,
        extra_metadata: dict[str, Any] | None = ...,  # type: ignore[assignment]
    ) -> Venue:
        venue = await self.get_venue_row(venue_id)
        await self._assert_venue_perm(ctx, venue, "venue.write", mutate=True)
        await self._require_active_org(venue.organization_id)
        if venue.status == "INACTIVE":
            raise AppError("INVALID_TRANSITION", "Inactive venues cannot be edited", 409)
        if expected_version is not None and venue.version != expected_version:
            raise ConflictError("Venue version conflict")
        if capacity is not None and capacity < 0:
            raise AppError("VALIDATION_ERROR", "capacity must be >= 0", 422)
        previous = {"name": venue.name, "capacity": venue.capacity, "version": venue.version}
        if name is not None:
            venue.name = name.strip()
        if capacity is not None:
            venue.capacity = capacity
        if address is not ...:
            venue.address = address
        if extra_metadata is not ...:
            venue.extra_metadata = extra_metadata
        venue.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action="venue.updated",
            entity_type="Venue",
            entity_id=venue.id,
            previous_state=previous,
            new_state={"name": venue.name, "capacity": venue.capacity, "version": venue.version},
            organization_id=venue.organization_id,
        )
        return venue

    async def transition_venue(
        self,
        ctx: AuthContext,
        venue_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
    ) -> Venue:
        venue = await self.get_venue_row(venue_id)
        await self._assert_venue_perm(ctx, venue, "venue.write", mutate=True)
        await self._require_active_org(venue.organization_id)
        if expected_version is not None and venue.version != expected_version:
            raise ConflictError("Venue version conflict")
        target = venue_target_for_action(action)
        previous = venue.status
        venue_transition_action(previous, target)
        venue.status = target
        venue.updated_by = ctx.user_id
        await self._flush_versioned()
        await self.audit.record_from_auth(
            ctx,
            action=f"venue.{action}",
            entity_type="Venue",
            entity_id=venue.id,
            previous_state={"status": previous},
            new_state={"status": venue.status},
            organization_id=venue.organization_id,
        )
        return venue

    async def invite_lineup(
        self,
        ctx: AuthContext,
        event_id: UUID,
        *,
        artist_id: UUID | None = None,
        band_id: UUID | None = None,
        billing_order: int = 0,
    ) -> EventLineup:
        from cornerroom.modules.artists.domain.models import Artist, Band

        event = await self.get_event_row(event_id)
        await self._assert_event_perm(ctx, event, "event.write", mutate=True)
        await self._require_active_org(event.organization_id)
        if (artist_id is None) == (band_id is None):
            raise AppError(
                "VALIDATION_ERROR",
                "Lineup requires exactly one of artist_id or band_id",
                422,
            )
        if artist_id is not None:
            artist = await self.session.get(Artist, artist_id)
            if artist is None or artist.deleted_at is not None or artist.status != "ACTIVE":
                raise AppError("VALIDATION_ERROR", "Only ACTIVE artists can be invited", 422)
        if band_id is not None:
            band = await self.session.get(Band, band_id)
            if band is None or band.deleted_at is not None or band.status != "ACTIVE":
                raise AppError("VALIDATION_ERROR", "Only ACTIVE bands can be invited", 422)
        row = EventLineup(
            event_id=event.id,
            artist_id=artist_id,
            band_id=band_id,
            billing_order=billing_order,
            status="INVITED",
            contract_id=None,
            created_by=ctx.user_id,
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("That artist or band is already on this lineup") from exc
        await self.audit.record_from_auth(
            ctx,
            action="event_lineup.invited",
            entity_type="EventLineup",
            entity_id=row.id,
            new_state={
                "event_id": str(event.id),
                "artist_id": str(artist_id) if artist_id else None,
                "band_id": str(band_id) if band_id else None,
                "status": "INVITED",
            },
            organization_id=event.organization_id,
        )
        return row

    async def list_lineup(
        self,
        event_id: UUID,
        ctx: AuthContext | None,
    ) -> list[EventLineup]:
        event, public_view = await self.get_event(event_id, ctx)
        stmt = select(EventLineup).where(
            EventLineup.event_id == event.id,
            EventLineup.deleted_at.is_(None),
        )
        if public_view or ctx is None:
            stmt = stmt.where(EventLineup.status.in_(tuple(PUBLIC_LINEUP_STATUSES)))
        else:
            can_write = await self._is_allowed(
                ctx.user_id,
                "event.write",
                resource_type="event",
                resource_id=event.id,
                organization_id=event.organization_id,
            )
            if not can_write:
                stmt = stmt.where(EventLineup.status.in_(tuple(PUBLIC_LINEUP_STATUSES)))
        stmt = stmt.order_by(EventLineup.billing_order.asc(), EventLineup.created_at.asc())
        return list((await self.session.execute(stmt)).scalars().all())

    async def transition_lineup(
        self,
        ctx: AuthContext,
        event_id: UUID,
        lineup_id: UUID,
        *,
        action: str,
        expected_version: int | None = None,
    ) -> EventLineup:
        event = await self.get_event_row(event_id)
        await self._assert_event_perm(ctx, event, "event.write", mutate=True)
        await self._require_active_org(event.organization_id)
        row = await self.session.get(EventLineup, lineup_id)
        if row is None or row.deleted_at is not None or row.event_id != event.id:
            raise NotFoundError("Lineup entry not found")
        if expected_version is not None and row.version != expected_version:
            raise ConflictError("Lineup version conflict")
        target = lineup_target_for_action(action)
        previous = row.status
        lineup_transition_action(previous, target)
        row.status = target
        row.updated_by = ctx.user_id
        await self._flush_versioned()
        if action == "confirm":
            event_type = LINEUP_CONFIRMED
            await self._milestone(
                event,
                milestone_type="lineup_confirmed",
                ctx=ctx,
                previous=previous,
                new_state=row.status,
                description="Lineup confirmed",
                metadata={"lineup_id": str(row.id)},
            )
        elif action == "withdraw":
            event_type = ARTIST_WITHDRAWN_FROM_EVENT
            await self._milestone(
                event,
                milestone_type="lineup_withdrawn",
                ctx=ctx,
                previous=previous,
                new_state=row.status,
                description="Artist or band withdrawn from event",
                metadata={"lineup_id": str(row.id)},
            )
        else:
            event_type = None
        if event_type is not None:
            domain = DomainEvent(
                event_type=event_type,
                producer="events",
                aggregate_type="Event",
                aggregate_id=event.id,
                payload={
                    "lineup_id": str(row.id),
                    "artist_id": str(row.artist_id) if row.artist_id else None,
                    "band_id": str(row.band_id) if row.band_id else None,
                    "status": row.status,
                },
                occurred_at=self.clock.now(),
                actor_id=ctx.user_id,
                organization_id=event.organization_id,
                correlation_id=ctx.request_id,
            )
            await enqueue_outbox(self.session, domain)
        await self.audit.record_from_auth(
            ctx,
            action=f"event_lineup.{action}",
            entity_type="EventLineup",
            entity_id=row.id,
            previous_state={"status": previous},
            new_state={"status": row.status},
            organization_id=event.organization_id,
        )
        return row
