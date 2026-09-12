"""Analytics ingest and daily projections. Not a ledger. Unique listeners NOT_AVAILABLE."""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ForbiddenError, NotFoundError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    ARTIST_FOLLOWED,
    CAMPAIGN_COMPLETED,
    CAMPAIGN_STARTED,
    DomainEvent,
    EVENT_CANCELLED,
    EVENT_COMPLETED,
    EVENT_PUBLISHED,
    EXPENSE_RECOGNIZED,
    ORDER_PAID,
    PAYMENT_FAILED,
    REFUND_COMPLETED,
    REVENUE_RECOGNIZED,
    SUBSCRIPTION_CANCELLED,
    SUBSCRIPTION_STARTED,
    TICKETING_OPENED,
    TRACK_LIKED,
    TRACK_PLAYED,
    TRACK_PURCHASED,
    TRACK_RELEASED,
    TRACK_TAKEN_DOWN,
    USER_REGISTERED,
)
from cornerroom.kernel.ports import NullNotificationPort
from cornerroom.modules.analytics.domain.metrics import (
    ASSUMED_METRIC_TIMEZONE,
    CONSUMER_ANALYTICS,
    METRIC_DEFINITION_VERSION,
    attribution_status,
    metric_date_for,
    never_negative,
    sanitize_properties,
    unique_listeners_metric,
)
from cornerroom.modules.artists.application.service import ArtistService
from cornerroom.modules.campaigns.application.service import CampaignService
from cornerroom.modules.events.application.service import EventService
from cornerroom.modules.music.application.service import MusicService
from cornerroom.modules.analytics.domain.models import (
    AnalyticsEvent,
    DailyCampaignMetrics,
    DailyEventMetrics,
    DailyTrackMetrics,
)
from cornerroom.modules.authorization.application.service import AuthorizationService

# Emitted by ticketing (not in kernel/events.py).
TICKET_PAID = "TicketPaid"
TICKET_ISSUED = "TicketIssued"
TICKET_CHECKED_IN = "TicketCheckedIn"

INGEST_EVENT_TYPES = frozenset(
    {
        EVENT_PUBLISHED,
        TICKETING_OPENED,
        TICKET_PAID,
        TICKET_ISSUED,
        TICKET_CHECKED_IN,
        EVENT_CANCELLED,
        EVENT_COMPLETED,
        REFUND_COMPLETED,
        TRACK_RELEASED,
        TRACK_PLAYED,
        TRACK_LIKED,
        TRACK_PURCHASED,
        TRACK_TAKEN_DOWN,
        ORDER_PAID,
        PAYMENT_FAILED,
        REVENUE_RECOGNIZED,
        EXPENSE_RECOGNIZED,
        SUBSCRIPTION_STARTED,
        SUBSCRIPTION_CANCELLED,
        CAMPAIGN_STARTED,
        CAMPAIGN_COMPLETED,
        ARTIST_FOLLOWED,
        USER_REGISTERED,
    }
)


def _uuid(value: object | None) -> UUID | None:
    if value is None or value == "":
        return None
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except (TypeError, ValueError):
        return None


class AnalyticsService:
    def __init__(self, session: AsyncSession, clock: Clock | None = None) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.authz = AuthorizationService(session, clock=self.clock)

    async def ingest_event(self, event: DomainEvent) -> AnalyticsEvent | None:
        if event.event_type not in INGEST_EVENT_TYPES:
            return None
        existing = (
            await self.session.execute(
                select(AnalyticsEvent).where(
                    AnalyticsEvent.source_event_id == event.event_id,
                    AnalyticsEvent.consumer == CONSUMER_ANALYTICS,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        payload = event.payload or {}
        row = AnalyticsEvent(
            source_event_id=event.event_id,
            consumer=CONSUMER_ANALYTICS,
            event_type=event.event_type,
            occurred_at=event.occurred_at,
            ingested_at=self.clock.now(),
            actor_id=event.actor_id,
            organization_id=event.organization_id,
            source_module=event.producer,
            source_entity_type=event.aggregate_type,
            source_entity_id=event.aggregate_id,
            correlation_id=event.correlation_id,
            schema_version=event.schema_version,
            properties=sanitize_properties(payload),
        )
        self.session.add(row)
        try:
            async with self.session.begin_nested():
                await self.session.flush()
        except IntegrityError:
            replay = (
                await self.session.execute(
                    select(AnalyticsEvent).where(
                        AnalyticsEvent.source_event_id == event.event_id,
                        AnalyticsEvent.consumer == CONSUMER_ANALYTICS,
                    )
                )
            ).scalar_one_or_none()
            return replay
        await self._apply_daily_increment(row)
        return row

    async def _apply_daily_increment(self, fact: AnalyticsEvent) -> None:
        metric_date = metric_date_for(fact.occurred_at)
        payload = fact.properties or {}
        if fact.event_type == TRACK_PLAYED:
            track_id = _uuid(payload.get("track_id")) or (
                fact.source_entity_id if fact.source_entity_type == "Track" else None
            )
            if track_id is None:
                return
            completed = 1 if payload.get("completed") else 0
            duration = never_negative(int(payload.get("duration_ms") or 0))
            await self._bump_track(
                metric_date,
                track_id,
                fact.organization_id,
                plays=1,
                completed=completed,
                duration_ms=duration,
            )
            return
        if fact.event_type in {TICKET_PAID, TICKET_ISSUED, TICKET_CHECKED_IN}:
            event_id = _uuid(payload.get("event_id")) or (
                fact.source_entity_id if fact.source_entity_type == "Event" else None
            )
            if event_id is None:
                return
            paid = 1 if fact.event_type == TICKET_PAID else 0
            issued = 1 if fact.event_type == TICKET_ISSUED else 0
            checked = 1 if fact.event_type == TICKET_CHECKED_IN else 0
            await self._bump_event(
                metric_date,
                event_id,
                fact.organization_id,
                paid=paid,
                issued=issued,
                checked=checked,
            )
            return
        if fact.event_type in {CAMPAIGN_STARTED, CAMPAIGN_COMPLETED}:
            campaign_id = _uuid(payload.get("campaign_id")) or (
                fact.source_entity_id if fact.source_entity_type == "Campaign" else None
            )
            if campaign_id is None:
                campaign_id = fact.source_entity_id
            if campaign_id is None:
                return
            await self._bump_campaign(metric_date, campaign_id, fact.organization_id, ingested=1)

    async def _bump_track(
        self,
        metric_date: date,
        track_id: UUID,
        organization_id: UUID | None,
        *,
        plays: int,
        completed: int,
        duration_ms: int,
    ) -> None:
        row = await self._get_or_create_track(metric_date, track_id, organization_id)
        row.play_count = never_negative(int(row.play_count) + never_negative(plays))
        row.completed_play_count = never_negative(
            int(row.completed_play_count) + never_negative(completed)
        )
        row.listen_duration_ms = never_negative(
            int(row.listen_duration_ms) + never_negative(duration_ms)
        )
        await self.session.flush()

    async def _bump_event(
        self,
        metric_date: date,
        event_id: UUID,
        organization_id: UUID | None,
        *,
        paid: int,
        issued: int,
        checked: int,
    ) -> None:
        row = await self._get_or_create_event(metric_date, event_id, organization_id)
        row.ticket_paid_count = never_negative(int(row.ticket_paid_count) + never_negative(paid))
        row.ticket_issued_count = never_negative(
            int(row.ticket_issued_count) + never_negative(issued)
        )
        row.ticket_checked_in_count = never_negative(
            int(row.ticket_checked_in_count) + never_negative(checked)
        )
        await self.session.flush()

    async def _bump_campaign(
        self,
        metric_date: date,
        campaign_id: UUID,
        organization_id: UUID | None,
        *,
        ingested: int,
    ) -> None:
        row = await self._get_or_create_campaign(metric_date, campaign_id, organization_id)
        row.ingested_event_count = never_negative(
            int(row.ingested_event_count) + never_negative(ingested)
        )
        await self.session.flush()

    async def _get_or_create_track(
        self, metric_date: date, track_id: UUID, organization_id: UUID | None
    ) -> DailyTrackMetrics:
        stmt = select(DailyTrackMetrics).where(
            DailyTrackMetrics.metric_date == metric_date,
            DailyTrackMetrics.track_id == track_id,
            DailyTrackMetrics.metric_definition_version == METRIC_DEFINITION_VERSION,
        )
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        if row is not None:
            return row
        row = DailyTrackMetrics(
            metric_date=metric_date,
            track_id=track_id,
            organization_id=organization_id,
            metric_definition_version=METRIC_DEFINITION_VERSION,
            play_count=0,
            completed_play_count=0,
            listen_duration_ms=0,
        )
        self.session.add(row)
        try:
            async with self.session.begin_nested():
                await self.session.flush()
        except IntegrityError:
            row = (await self.session.execute(stmt)).scalar_one()
        return row

    async def _get_or_create_event(
        self, metric_date: date, event_id: UUID, organization_id: UUID | None
    ) -> DailyEventMetrics:
        stmt = select(DailyEventMetrics).where(
            DailyEventMetrics.metric_date == metric_date,
            DailyEventMetrics.event_id == event_id,
            DailyEventMetrics.metric_definition_version == METRIC_DEFINITION_VERSION,
        )
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        if row is not None:
            return row
        row = DailyEventMetrics(
            metric_date=metric_date,
            event_id=event_id,
            organization_id=organization_id,
            metric_definition_version=METRIC_DEFINITION_VERSION,
            ticket_paid_count=0,
            ticket_issued_count=0,
            ticket_checked_in_count=0,
        )
        self.session.add(row)
        try:
            async with self.session.begin_nested():
                await self.session.flush()
        except IntegrityError:
            row = (await self.session.execute(stmt)).scalar_one()
        return row

    async def _get_or_create_campaign(
        self, metric_date: date, campaign_id: UUID, organization_id: UUID | None
    ) -> DailyCampaignMetrics:
        stmt = select(DailyCampaignMetrics).where(
            DailyCampaignMetrics.metric_date == metric_date,
            DailyCampaignMetrics.campaign_id == campaign_id,
            DailyCampaignMetrics.metric_definition_version == METRIC_DEFINITION_VERSION,
        )
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        if row is not None:
            return row
        row = DailyCampaignMetrics(
            metric_date=metric_date,
            campaign_id=campaign_id,
            organization_id=organization_id,
            metric_definition_version=METRIC_DEFINITION_VERSION,
            ingested_event_count=0,
        )
        self.session.add(row)
        try:
            async with self.session.begin_nested():
                await self.session.flush()
        except IntegrityError:
            row = (await self.session.execute(stmt)).scalar_one()
        return row

    async def aggregate_daily_metrics(self, metric_date: date | None = None) -> int:
        """Rebuild daily_* for a Dhaka calendar date from analytics_events (idempotent overwrite)."""
        target = metric_date or metric_date_for(self.clock.now())
        facts = list(
            (
                await self.session.execute(
                    select(AnalyticsEvent).where(
                        AnalyticsEvent.consumer == CONSUMER_ANALYTICS,
                    )
                )
            ).scalars().all()
        )
        track_acc: dict[tuple[date, UUID], dict[str, int | UUID | None]] = {}
        event_acc: dict[tuple[date, UUID], dict[str, int | UUID | None]] = {}
        campaign_acc: dict[tuple[date, UUID], dict[str, int | UUID | None]] = {}
        for fact in facts:
            day = metric_date_for(fact.occurred_at)
            if day != target:
                continue
            payload = fact.properties or {}
            if fact.event_type == TRACK_PLAYED:
                track_id = _uuid(payload.get("track_id"))
                if track_id is None:
                    continue
                key = (day, track_id)
                acc = track_acc.setdefault(
                    key,
                    {
                        "plays": 0,
                        "completed": 0,
                        "duration_ms": 0,
                        "organization_id": fact.organization_id,
                    },
                )
                acc["plays"] = int(acc["plays"]) + 1
                acc["completed"] = int(acc["completed"]) + (1 if payload.get("completed") else 0)
                acc["duration_ms"] = int(acc["duration_ms"]) + never_negative(
                    int(payload.get("duration_ms") or 0)
                )
            elif fact.event_type in {TICKET_PAID, TICKET_ISSUED, TICKET_CHECKED_IN}:
                event_id = _uuid(payload.get("event_id"))
                if event_id is None:
                    continue
                key = (day, event_id)
                acc = event_acc.setdefault(
                    key,
                    {
                        "paid": 0,
                        "issued": 0,
                        "checked": 0,
                        "organization_id": fact.organization_id,
                    },
                )
                if fact.event_type == TICKET_PAID:
                    acc["paid"] = int(acc["paid"]) + 1
                elif fact.event_type == TICKET_ISSUED:
                    acc["issued"] = int(acc["issued"]) + 1
                else:
                    acc["checked"] = int(acc["checked"]) + 1
            elif fact.event_type in {CAMPAIGN_STARTED, CAMPAIGN_COMPLETED}:
                campaign_id = fact.source_entity_id
                if campaign_id is None:
                    continue
                key = (day, campaign_id)
                acc = campaign_acc.setdefault(
                    key,
                    {"ingested": 0, "organization_id": fact.organization_id},
                )
                acc["ingested"] = int(acc["ingested"]) + 1
        written = 0
        for (day, track_id), acc in track_acc.items():
            row = await self._get_or_create_track(day, track_id, acc.get("organization_id"))  # type: ignore[arg-type]
            row.play_count = never_negative(int(acc["plays"]))
            row.completed_play_count = never_negative(int(acc["completed"]))
            row.listen_duration_ms = never_negative(int(acc["duration_ms"]))
            written += 1
        for (day, event_id), acc in event_acc.items():
            row = await self._get_or_create_event(day, event_id, acc.get("organization_id"))  # type: ignore[arg-type]
            row.ticket_paid_count = never_negative(int(acc["paid"]))
            row.ticket_issued_count = never_negative(int(acc["issued"]))
            row.ticket_checked_in_count = never_negative(int(acc["checked"]))
            written += 1
        for (day, campaign_id), acc in campaign_acc.items():
            row = await self._get_or_create_campaign(day, campaign_id, acc.get("organization_id"))  # type: ignore[arg-type]
            row.ingested_event_count = never_negative(int(acc["ingested"]))
            written += 1
        await self.session.flush()
        return written

    def unique_listeners(self) -> str:
        return unique_listeners_metric()

    def attribution(self) -> str:
        return attribution_status()

    def validate_metric_range(self, from_date: date | None, to_date: date | None) -> None:
        if from_date is not None and to_date is not None and from_date > to_date:
            raise AppError(
                "INVALID_DATE_RANGE",
                "Invalid date range",
                400,
                "from must not be after to",
            )

    def _workspace(self, ctx: AuthContext) -> UUID:
        if ctx.organization_id is None:
            raise AppError("WORKSPACE_REQUIRED", "Active organization workspace is required", 409)
        return ctx.organization_id

    def _timezone_meta(self) -> dict[str, str]:
        return {
            "metric_timezone": ASSUMED_METRIC_TIMEZONE,
            "metric_timezone_status": "ASSUMED",
        }

    def _money_tile(self) -> dict[str, str]:
        return {"status": "NOT_AVAILABLE"}

    async def assert_analytics_read(self, ctx: AuthContext, org_id: UUID | None = None) -> None:
        """Gate 4 helper. Analyst must not receive finance.read via this path."""
        if ctx.actor_type == "system":
            return
        scope = org_id or ctx.organization_id
        try:
            if scope is None:
                await self.authz.authorize(ctx.user_id, "analytics.read")
            else:
                await self.authz.authorize(
                    ctx.user_id,
                    "analytics.read",
                    resource_type="organization",
                    resource_id=scope,
                    scope_organization_id=scope,
                )
        except ForbiddenError as exc:
            raise NotFoundError("Not found") from exc

    async def _has_finance_read(self, ctx: AuthContext, org_id: UUID) -> bool:
        try:
            await self.authz.authorize(
                ctx.user_id,
                "finance.read",
                resource_type="organization",
                resource_id=org_id,
                scope_organization_id=org_id,
            )
            return True
        except ForbiddenError:
            return False

    def _assert_workspace_resource(self, ctx: AuthContext, resource_org_id: UUID | None) -> None:
        if ctx.organization_id is None or resource_org_id is None:
            return
        if resource_org_id != ctx.organization_id:
            raise NotFoundError("Not found")

    def _apply_dates(self, stmt: Any, column: Any, from_date: date | None, to_date: date | None):
        if from_date is not None:
            stmt = stmt.where(column >= from_date)
        if to_date is not None:
            stmt = stmt.where(column <= to_date)
        return stmt

    async def read_staff_overview(
        self,
        ctx: AuthContext,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> dict[str, Any]:
        self.validate_metric_range(from_date, to_date)
        org_id = self._workspace(ctx)
        await self.assert_analytics_read(ctx, org_id)
        has_finance = await self._has_finance_read(ctx, org_id)
        track_stmt = select(
            func.coalesce(func.sum(DailyTrackMetrics.play_count), 0),
            func.coalesce(func.sum(DailyTrackMetrics.completed_play_count), 0),
            func.coalesce(func.sum(DailyTrackMetrics.listen_duration_ms), 0),
        ).where(DailyTrackMetrics.organization_id == org_id)
        track_stmt = self._apply_dates(track_stmt, DailyTrackMetrics.metric_date, from_date, to_date)
        plays, completed, duration = (await self.session.execute(track_stmt)).one()
        event_stmt = select(
            func.coalesce(func.sum(DailyEventMetrics.ticket_paid_count), 0),
            func.coalesce(func.sum(DailyEventMetrics.ticket_issued_count), 0),
            func.coalesce(func.sum(DailyEventMetrics.ticket_checked_in_count), 0),
        ).where(DailyEventMetrics.organization_id == org_id)
        event_stmt = self._apply_dates(event_stmt, DailyEventMetrics.metric_date, from_date, to_date)
        paid, issued, checked = (await self.session.execute(event_stmt)).one()
        campaign_stmt = select(
            func.coalesce(func.sum(DailyCampaignMetrics.ingested_event_count), 0),
        ).where(DailyCampaignMetrics.organization_id == org_id)
        campaign_stmt = self._apply_dates(
            campaign_stmt, DailyCampaignMetrics.metric_date, from_date, to_date
        )
        (ingested,) = (await self.session.execute(campaign_stmt)).one()
        body = {
            "organization_id": org_id,
            "from": from_date,
            "to": to_date,
            **self._timezone_meta(),
            "tracks": {
                "play_count": int(plays or 0),
                "completed_play_count": int(completed or 0),
                "listen_duration_ms": int(duration or 0),
                "unique_listeners": unique_listeners_metric(),
            },
            "events": {
                "ticket_paid_count": int(paid or 0),
                "ticket_issued_count": int(issued or 0),
                "ticket_checked_in_count": int(checked or 0),
            },
            "campaigns": {
                "ingested_event_count": int(ingested or 0),
                "attribution_status": attribution_status(),
            },
            "money": self._money_tile() if has_finance else {"status": "NOT_AVAILABLE"},
        }
        return body

    async def read_track(
        self,
        ctx: AuthContext,
        track_id: UUID,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> dict[str, Any]:
        self.validate_metric_range(from_date, to_date)
        music = MusicService(self.session)
        track = await music.get_track_row(track_id)
        self._assert_workspace_resource(ctx, track.primary_org_id)
        if not await self._can_read_track(ctx, track):
            raise NotFoundError("Not found")
        stmt = select(
            func.coalesce(func.sum(DailyTrackMetrics.play_count), 0),
            func.coalesce(func.sum(DailyTrackMetrics.completed_play_count), 0),
            func.coalesce(func.sum(DailyTrackMetrics.listen_duration_ms), 0),
        ).where(DailyTrackMetrics.track_id == track_id)
        stmt = self._apply_dates(stmt, DailyTrackMetrics.metric_date, from_date, to_date)
        plays, completed, duration = (await self.session.execute(stmt)).one()
        return {
            "track_id": track_id,
            "from": from_date,
            "to": to_date,
            **self._timezone_meta(),
            "play_count": int(plays or 0),
            "completed_play_count": int(completed or 0),
            "listen_duration_ms": int(duration or 0),
            "unique_listeners": unique_listeners_metric(),
        }

    async def read_event(
        self,
        ctx: AuthContext,
        event_id: UUID,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> dict[str, Any]:
        self.validate_metric_range(from_date, to_date)
        event = await EventService(self.session).get_event_row(event_id)
        self._assert_workspace_resource(ctx, event.organization_id)
        if not await self._allowed(
            ctx,
            "analytics.read",
            resource_type="event",
            resource_id=event.id,
            organization_id=event.organization_id,
        ):
            raise NotFoundError("Not found")
        stmt = select(
            func.coalesce(func.sum(DailyEventMetrics.ticket_paid_count), 0),
            func.coalesce(func.sum(DailyEventMetrics.ticket_issued_count), 0),
            func.coalesce(func.sum(DailyEventMetrics.ticket_checked_in_count), 0),
        ).where(DailyEventMetrics.event_id == event_id)
        stmt = self._apply_dates(stmt, DailyEventMetrics.metric_date, from_date, to_date)
        paid, issued, checked = (await self.session.execute(stmt)).one()
        return {
            "event_id": event_id,
            "from": from_date,
            "to": to_date,
            **self._timezone_meta(),
            "ticket_paid_count": int(paid or 0),
            "ticket_issued_count": int(issued or 0),
            "ticket_checked_in_count": int(checked or 0),
            "unique_listeners": unique_listeners_metric(),
        }

    async def read_campaign(
        self,
        ctx: AuthContext,
        campaign_id: UUID,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> dict[str, Any]:
        self.validate_metric_range(from_date, to_date)
        campaign = await CampaignService(
            self.session, notifications=NullNotificationPort()
        ).get_campaign_row(campaign_id)
        self._assert_workspace_resource(ctx, campaign.organization_id)
        if not await self._allowed(
            ctx,
            "campaign.write",
            resource_type="campaign",
            resource_id=campaign.id,
            organization_id=campaign.organization_id,
        ):
            raise NotFoundError("Not found")
        stmt = select(
            func.coalesce(func.sum(DailyCampaignMetrics.ingested_event_count), 0),
        ).where(DailyCampaignMetrics.campaign_id == campaign_id)
        stmt = self._apply_dates(stmt, DailyCampaignMetrics.metric_date, from_date, to_date)
        (ingested,) = (await self.session.execute(stmt)).one()
        return {
            "campaign_id": campaign_id,
            "from": from_date,
            "to": to_date,
            **self._timezone_meta(),
            "ingested_event_count": int(ingested or 0),
            "attribution_status": attribution_status(),
        }

    async def read_artist(
        self,
        ctx: AuthContext,
        artist_id: UUID,
        *,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> dict[str, Any]:
        """Artist grain is not projected in daily_*. Unique listeners remain NOT_AVAILABLE."""
        self.validate_metric_range(from_date, to_date)
        artist = await ArtistService(self.session).get_artist_row(artist_id)
        self._assert_workspace_resource(ctx, artist.primary_org_id)
        if not await self._allowed(
            ctx,
            "analytics.read",
            resource_type="artist",
            resource_id=artist.id,
            organization_id=artist.primary_org_id,
            owner_user_id=artist.claimed_user_id,
        ):
            raise NotFoundError("Not found")
        return {
            "artist_id": artist_id,
            "from": from_date,
            "to": to_date,
            **self._timezone_meta(),
            "unique_listeners": unique_listeners_metric(),
        }

    async def _can_read_track(self, ctx: AuthContext, track: Any) -> bool:
        if await self._allowed(
            ctx,
            "analytics.read",
            resource_type="track",
            resource_id=track.id,
            organization_id=track.primary_org_id,
        ):
            return True
        if track.primary_artist_id is None:
            return False
        try:
            artist = await ArtistService(self.session).get_artist_row(track.primary_artist_id)
        except NotFoundError:
            return False
        return await self._allowed(
            ctx,
            "analytics.read",
            resource_type="artist",
            resource_id=artist.id,
            organization_id=artist.primary_org_id,
            owner_user_id=artist.claimed_user_id,
        )

    async def _allowed(
        self,
        ctx: AuthContext,
        permission: str,
        *,
        resource_type: str,
        resource_id: UUID,
        organization_id: UUID | None,
        owner_user_id: UUID | None = None,
    ) -> bool:
        try:
            await self.authz.authorize(
                ctx.user_id,
                permission,
                resource_type=resource_type,
                resource_id=resource_id,
                owner_user_id=owner_user_id,
                scope_organization_id=organization_id,
            )
            return True
        except ForbiddenError:
            return False


class SessionAnalyticsPort:
    """If bound, ingest must be the same idempotent path as outbox (requires source_event_id)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def record(self, event_name: str, payload: dict) -> None:
        source = payload.get("source_event_id")
        if not source:
            return
        from datetime import datetime, timezone
        from uuid import UUID as _UUID

        occurred = payload.get("occurred_at")
        if isinstance(occurred, str):
            occurred_at = datetime.fromisoformat(occurred)
        elif isinstance(occurred, datetime):
            occurred_at = occurred
        else:
            occurred_at = datetime.now(timezone.utc)
        event = DomainEvent(
            event_id=_UUID(str(source)),
            event_type=event_name,
            producer=str(payload.get("producer") or "analytics_port"),
            aggregate_type=str(payload.get("aggregate_type") or "Unknown"),
            aggregate_id=_UUID(str(payload["aggregate_id"]))
            if payload.get("aggregate_id")
            else _UUID(str(source)),
            payload=payload,
            occurred_at=occurred_at,
        )
        await AnalyticsService(self.session).ingest_event(event)
