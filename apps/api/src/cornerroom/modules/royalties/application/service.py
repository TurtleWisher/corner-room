"""Royalty application service. Controllers stay thin. Not a Finance ledger."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from cornerroom.infra.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    REVENUE_POOL_CREATED,
    REVENUE_POOL_FROZEN,
    REVENUE_RECOGNIZED,
    RIGHT_CREATED,
    RIGHT_SHARE_ASSIGNED,
    ROYALTY_APPROVED,
    ROYALTY_CALCULATION_COMPLETED,
    ROYALTY_CALCULATION_STARTED,
    ROYALTY_GENERATED,
    ROYALTY_RULE_ACTIVATED,
    ROYALTY_RULE_CREATED,
    ROYALTY_STATEMENT_ADJUSTED,
    ROYALTY_STATEMENT_ISSUED,
    SETTLEMENT_APPROVED,
    DomainEvent,
)
from cornerroom.kernel.money import Money
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.kernel.ports import NotificationPort, NullNotificationPort
from cornerroom.modules.artists.domain.models import Artist
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.commerce.domain.models import Order, OrderItem
from cornerroom.modules.music.domain.models import Track
from cornerroom.modules.royalties.application.accrual import OutboxRoyaltyAccrual, RoyaltyAccrualPort
from cornerroom.modules.royalties.application.recognized import (
    IntakeRecognizedRevenue,
    RecognizedRevenuePort,
)
from cornerroom.modules.royalties.domain.allocation import (
    ResidualPayee,
    ShareSlice,
    allocate_pool,
    validate_share_coverage,
)
from cornerroom.modules.royalties.domain.eligibility import (
    PlaybackFact,
    eligible_time_by_track,
    eligible_units_by_track,
    parse_eligibility,
)
from cornerroom.modules.royalties.domain.lifecycle import (
    PAYEE_TYPES,
    POOL_SOURCE_TYPES,
    RULE_POOL_TYPES,
    RUN_KINDS,
    SUPPORTED_POOL_TYPES,
    pool_transition_action,
    right_transition_action,
    royalty_transition_action,
    rule_transition_action,
    settlement_transition_action,
    statement_transition_action,
)
from cornerroom.modules.royalties.domain.models import (
    RevenuePool,
    RightShare,
    Rights,
    Royalty,
    RoyaltyAdjustment,
    RoyaltyLine,
    RoyaltyRule,
    RoyaltyStatement,
    Settlement,
    SettlementLine,
)
from cornerroom.modules.streaming.domain.models import PlaybackEvent


class RoyaltyService:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
        notifications: NotificationPort | None = None,
        recognized: RecognizedRevenuePort | None = None,
        accrual: RoyaltyAccrualPort | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)
        self.notifications = notifications or NullNotificationPort()
        self.recognized = recognized or IntakeRecognizedRevenue(session)
        self.accrual = accrual or OutboxRoyaltyAccrual(session, self.clock)

    def _recognized_port(self, ctx: AuthContext, org_id: UUID) -> RecognizedRevenuePort:
        bind = getattr(self.recognized, "bind", None)
        if bind is not None:
            return bind(organization_id=org_id, ctx=ctx)
        return self.recognized

    def _accrual_port(self, org_id: UUID) -> RoyaltyAccrualPort:
        bind = getattr(self.accrual, "bind", None)
        if bind is not None:
            return bind(org_id)
        return self.accrual

    def _workspace(self, ctx: AuthContext) -> UUID:
        if ctx.organization_id is None:
            raise AppError(
                "WORKSPACE_REQUIRED",
                "Active organization workspace is required",
                409,
                "Switch to an organization before mutating royalty resources",
            )
        return ctx.organization_id

    async def _staff(self, ctx: AuthContext, permission: str, org_id: UUID) -> None:
        try:
            await self.authz.authorize(
                ctx.user_id,
                permission,
                resource_type="organization",
                resource_id=org_id,
                scope_organization_id=org_id,
            )
        except ForbiddenError as exc:
            raise NotFoundError("Not found") from exc

    async def _emit(
        self,
        ctx: AuthContext | None,
        *,
        event_type: str,
        aggregate_type: str,
        aggregate_id: UUID,
        payload: dict[str, Any],
        organization_id: UUID | None = None,
    ) -> None:
        event = DomainEvent(
            event_type=event_type,
            producer="royalties",
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id if ctx else None,
            organization_id=organization_id,
            correlation_id=ctx.request_id if ctx else None,
        )
        await enqueue_outbox(self.session, event)

    async def _flush(self) -> None:
        try:
            await self.session.flush()
        except StaleDataError as exc:
            raise ConflictError("The resource was updated concurrently") from exc
        except IntegrityError as exc:
            raise ConflictError("Conflicting royalty state") from exc

    async def _track(self, track_id: UUID) -> Track:
        track = await self.session.get(Track, track_id)
        if track is None or track.deleted_at is not None:
            raise NotFoundError("Track not found")
        return track

    async def _org_for_track(self, track: Track) -> UUID:
        if track.primary_org_id is None:
            raise AppError(
                "WORKSPACE_REQUIRED",
                "Track has no organization affiliation",
                409,
                "Rights cannot be managed without catalog affiliation",
            )
        return track.primary_org_id

    def _residual(self, rights: Rights, right_type: str) -> ResidualPayee | None:
        if rights.residual_payee_type is None or rights.residual_payee_id is None:
            return None
        return ResidualPayee(
            rights_id=rights.id,
            payee_type=rights.residual_payee_type,
            payee_id=rights.residual_payee_id,
            right_type=right_type,
        )

    def _share_active(self, share: RightShare, as_of: datetime) -> bool:
        if share.effective_from > as_of:
            return False
        if share.effective_to is not None and share.effective_to <= as_of:
            return False
        return True

    async def claimed_artist_ids(self, user_id: UUID) -> list[UUID]:
        rows = (
            await self.session.execute(
                select(Artist.id).where(
                    Artist.claimed_user_id == user_id,
                    Artist.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        return list(rows)

    async def _is_payee(self, user_id: UUID, payee_type: str, payee_id: UUID) -> bool:
        if payee_type == "USER" and payee_id == user_id:
            return True
        if payee_type == "ARTIST":
            artist = await self.session.get(Artist, payee_id)
            return (
                artist is not None
                and artist.deleted_at is None
                and artist.claimed_user_id == user_id
            )
        return False

    async def put_track_rights(
        self,
        ctx: AuthContext,
        track_id: UUID,
        *,
        territory: str,
        residual_payee_type: str | None,
        residual_payee_id: UUID | None,
        shares: list[dict[str, Any]],
        contract_id: UUID | None = None,
    ) -> tuple[Rights, list[RightShare]]:
        track = await self._track(track_id)
        org_id = await self._org_for_track(track)
        await self._staff(ctx, "royalty.run", org_id)
        if (residual_payee_type is None) != (residual_payee_id is None):
            raise AppError("INVALID_RESIDUAL", "Residual payee type and id must be paired", 422)
        if residual_payee_type is not None and residual_payee_type not in PAYEE_TYPES:
            raise AppError("INVALID_PAYEE", "Unknown residual payee type", 422)
        existing = (
            await self.session.execute(
                select(Rights).where(Rights.track_id == track_id, Rights.status == "DRAFT")
            )
        ).scalar_one_or_none()
        if existing is None:
            existing = Rights(
                track_id=track_id,
                territory=territory.strip() or "WW",
                status="DRAFT",
                contract_id=contract_id,
                residual_payee_type=residual_payee_type,
                residual_payee_id=residual_payee_id,
                created_by=ctx.user_id,
                updated_by=ctx.user_id,
            )
            self.session.add(existing)
            await self._flush()
            await self._emit(
                ctx,
                event_type=RIGHT_CREATED,
                aggregate_type="Rights",
                aggregate_id=existing.id,
                payload={"track_id": str(track_id), "status": existing.status},
                organization_id=org_id,
            )
        else:
            existing.territory = territory.strip() or "WW"
            existing.residual_payee_type = residual_payee_type
            existing.residual_payee_id = residual_payee_id
            existing.contract_id = contract_id
            existing.updated_by = ctx.user_id
            old = (
                await self.session.execute(select(RightShare).where(RightShare.rights_id == existing.id))
            ).scalars().all()
            for row in old:
                await self.session.delete(row)
            await self._flush()
        created: list[RightShare] = []
        for item in shares:
            payee_type = str(item.get("payee_type") or "")
            if payee_type not in PAYEE_TYPES:
                raise AppError("INVALID_PAYEE", "Unknown payee type", 422)
            right_type = str(item.get("right_type") or "").strip()
            if not right_type:
                raise AppError("VALIDATION_ERROR", "right_type is required", 422)
            share_bps = int(item["share_bps"])
            effective_from = item["effective_from"]
            if isinstance(effective_from, str):
                effective_from = datetime.fromisoformat(effective_from.replace("Z", "+00:00"))
            effective_to = item.get("effective_to")
            if isinstance(effective_to, str):
                effective_to = datetime.fromisoformat(effective_to.replace("Z", "+00:00"))
            row = RightShare(
                rights_id=existing.id,
                right_type=right_type,
                payee_type=payee_type,
                payee_id=UUID(str(item["payee_id"])),
                share_bps=share_bps,
                effective_from=effective_from,
                effective_to=effective_to,
                created_by=ctx.user_id,
                updated_by=ctx.user_id,
            )
            self.session.add(row)
            created.append(row)
        await self._flush()
        grouped: dict[tuple[str, str, str], list[int]] = {}
        for row in created:
            key = (row.right_type, row.effective_from.isoformat(), str(row.effective_to))
            grouped.setdefault(key, []).append(row.share_bps)
        for right_type, _from, _to in grouped:
            residual = self._residual(existing, right_type)
            validate_share_coverage(grouped[(right_type, _from, _to)], residual)
        await self.audit.record_from_auth(
            ctx,
            action="rights.replaced",
            entity_type="Rights",
            entity_id=existing.id,
            new_state={"status": existing.status, "share_count": len(created)},
            organization_id=org_id,
        )
        await self._emit(
            ctx,
            event_type=RIGHT_SHARE_ASSIGNED,
            aggregate_type="Rights",
            aggregate_id=existing.id,
            payload={"track_id": str(track_id), "share_count": len(created)},
            organization_id=org_id,
        )
        return existing, created

    async def get_track_rights(self, ctx: AuthContext, track_id: UUID) -> tuple[Rights | None, list[RightShare]]:
        track = await self._track(track_id)
        org_id = track.primary_org_id
        allowed = False
        if org_id is not None:
            try:
                await self._staff(ctx, "royalty.read", org_id)
                allowed = True
            except NotFoundError:
                allowed = False
        if not allowed:
            try:
                await self._staff(ctx, "royalty.run", org_id or self._workspace(ctx))
                allowed = True
            except (NotFoundError, AppError):
                allowed = False
        if not allowed:
            raise NotFoundError("Rights not found")
        rights = (
            await self.session.execute(
                select(Rights).where(Rights.track_id == track_id).order_by(Rights.created_at.desc())
            )
        ).scalars().first()
        if rights is None:
            return None, []
        shares = (
            await self.session.execute(select(RightShare).where(RightShare.rights_id == rights.id))
        ).scalars().all()
        return rights, list(shares)

    async def transition_rights(self, ctx: AuthContext, rights_id: UUID, action: str) -> Rights:
        rights = await self.session.get(Rights, rights_id)
        if rights is None:
            raise NotFoundError("Rights not found")
        track = await self._track(rights.track_id) if rights.track_id else None
        org_id = track.primary_org_id if track else self._workspace(ctx)
        if org_id is None:
            raise AppError("WORKSPACE_REQUIRED", "Organization scope is required", 409)
        await self._staff(ctx, "royalty.run", org_id)
        targets = {
            "activate": "ACTIVE",
            "dispute": "DISPUTED",
            "retire": "RETIRED",
            "resolve": "ACTIVE",
        }
        target = targets.get(action)
        if target is None:
            raise AppError("INVALID_TRANSITION", "Unknown rights action", 422)
        right_transition_action(rights.status, target)
        if target == "ACTIVE":
            shares = list(
                (
                    await self.session.execute(select(RightShare).where(RightShare.rights_id == rights.id))
                ).scalars().all()
            )
            now = self.clock.now()
            active = [row for row in shares if self._share_active(row, now)]
            grouped: dict[str, list[int]] = {}
            for row in active:
                grouped.setdefault(row.right_type, []).append(row.share_bps)
            if not grouped:
                raise AppError("NO_VALID_SHARE", "Cannot activate rights without currently effective shares", 409)
            for right_type, bps_list in grouped.items():
                validate_share_coverage(bps_list, self._residual(rights, right_type))
        previous = rights.status
        rights.status = target
        rights.updated_by = ctx.user_id
        await self._flush()
        await self.audit.record_from_auth(
            ctx,
            action=f"rights.{action}",
            entity_type="Rights",
            entity_id=rights.id,
            previous_state={"status": previous},
            new_state={"status": rights.status},
            organization_id=org_id,
        )
        return rights

    async def create_rule(
        self,
        ctx: AuthContext,
        *,
        key: str,
        definition: dict[str, Any],
        version_number: int = 1,
    ) -> RoyaltyRule:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        pool_type = str(definition.get("pool_type") or "")
        if pool_type not in RULE_POOL_TYPES:
            raise AppError(
                "RULE_INCOMPLETE",
                "RoyaltyRule.definition.pool_type is required data",
                422,
                "Do not infer a formula; store the template on the rule",
            )
        if not str(definition.get("right_type") or "").strip():
            raise AppError(
                "RULE_INCOMPLETE",
                "RoyaltyRule.definition.right_type is required",
                422,
                "Publishing vs master remains open (Q-P1-09); the rule must name the right_type",
            )
        row = RoyaltyRule(
            key=key.strip(),
            version_number=version_number,
            status="DRAFT",
            definition=definition,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        if not row.key:
            raise AppError("VALIDATION_ERROR", "Rule key is required", 422)
        self.session.add(row)
        await self._flush()
        await self._emit(
            ctx,
            event_type=ROYALTY_RULE_CREATED,
            aggregate_type="RoyaltyRule",
            aggregate_id=row.id,
            payload={"key": row.key, "version": row.version_number},
            organization_id=org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="royalty_rule.created",
            entity_type="RoyaltyRule",
            entity_id=row.id,
            new_state={"key": row.key, "status": row.status, "version": row.version_number},
            organization_id=org_id,
        )
        return row

    async def transition_rule(self, ctx: AuthContext, rule_id: UUID, action: str) -> RoyaltyRule:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        rule = await self.session.get(RoyaltyRule, rule_id)
        if rule is None:
            raise NotFoundError("Royalty rule not found")
        targets = {"activate": "ACTIVE", "supersede": "SUPERSEDED"}
        target = targets.get(action)
        if target is None:
            raise AppError("INVALID_TRANSITION", "Unknown rule action", 422)
        rule_transition_action(rule.status, target)
        if target == "ACTIVE":
            current = (
                await self.session.execute(
                    select(RoyaltyRule).where(
                        RoyaltyRule.key == rule.key,
                        RoyaltyRule.status == "ACTIVE",
                        RoyaltyRule.id != rule.id,
                    )
                )
            ).scalars().all()
            for other in current:
                rule_transition_action(other.status, "SUPERSEDED")
                other.status = "SUPERSEDED"
                other.updated_by = ctx.user_id
        previous = rule.status
        rule.status = target
        rule.updated_by = ctx.user_id
        await self._flush()
        if target == "ACTIVE":
            await self._emit(
                ctx,
                event_type=ROYALTY_RULE_ACTIVATED,
                aggregate_type="RoyaltyRule",
                aggregate_id=rule.id,
                payload={"key": rule.key, "version": rule.version_number},
                organization_id=org_id,
            )
        await self.audit.record_from_auth(
            ctx,
            action=f"royalty_rule.{action}",
            entity_type="RoyaltyRule",
            entity_id=rule.id,
            previous_state={"status": previous},
            new_state={"status": rule.status},
            organization_id=org_id,
        )
        return rule

    async def list_rules(self, ctx: AuthContext) -> list[RoyaltyRule]:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "royalty.read", org_id)
        return list((await self.session.execute(select(RoyaltyRule).order_by(RoyaltyRule.key))).scalars().all())

    async def record_recognized_revenue(
        self,
        ctx: AuthContext,
        *,
        source_type: str,
        period_start: datetime,
        period_end: datetime,
        amount_minor: int,
        currency_code: str,
        idempotency_key: str,
        source_id: UUID | None = None,
    ) -> Any:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        if source_type not in POOL_SOURCE_TYPES:
            raise AppError("VALIDATION_ERROR", "Unknown recognized-revenue source_type", 422)
        Money(amount_minor, currency_code)
        fact = await self._recognized_port(ctx, org_id).record(
            source_type=source_type,
            period_start=period_start,
            period_end=period_end,
            amount_minor=amount_minor,
            currency_code=currency_code,
            idempotency_key=idempotency_key,
            source_id=source_id,
            actor_id=ctx.user_id,
        )
        await self._emit(
            ctx,
            event_type=REVENUE_RECOGNIZED,
            aggregate_type="RecognizedRevenueIntake",
            aggregate_id=fact.intake_id,
            payload={
                "source_type": fact.source_type,
                "amount_minor": fact.money.amount_minor,
                "currency_code": fact.money.currency_code,
            },
            organization_id=org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="recognized_revenue.recorded",
            entity_type="RecognizedRevenueIntake",
            entity_id=fact.intake_id,
            new_state={"amount_minor": fact.money.amount_minor, "source_type": source_type},
            organization_id=org_id,
        )
        return fact

    async def create_pool(
        self,
        ctx: AuthContext,
        *,
        period_start: datetime,
        period_end: datetime,
        source_type: str,
        currency_code: str,
        rule_id: UUID,
    ) -> RevenuePool:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        if source_type not in POOL_SOURCE_TYPES:
            raise AppError("VALIDATION_ERROR", "Unknown pool source_type", 422)
        if period_end <= period_start:
            raise AppError("INVALID_PERIOD", "period_end must be after period_start", 422)
        rule = await self.session.get(RoyaltyRule, rule_id)
        if rule is None:
            raise NotFoundError("Royalty rule not found")
        money = Money(0, currency_code)
        pool = RevenuePool(
            period_start=period_start,
            period_end=period_end,
            source_type=source_type,
            currency_code=money.currency_code,
            amount_minor=0,
            status="OPEN",
            rule_id=rule.id,
            organization_id=org_id,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(pool)
        await self._flush()
        await self._emit(
            ctx,
            event_type=REVENUE_POOL_CREATED,
            aggregate_type="RevenuePool",
            aggregate_id=pool.id,
            payload={"source_type": source_type, "status": pool.status},
            organization_id=org_id,
        )
        return pool

    async def freeze_pool(self, ctx: AuthContext, pool_id: UUID) -> RevenuePool:
        pool = await self.session.get(RevenuePool, pool_id)
        if pool is None:
            raise NotFoundError("Revenue pool not found")
        org_id = pool.organization_id or self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        pool_transition_action(pool.status, "FROZEN")
        fact = await self._recognized_port(ctx, org_id).amount_for(
            source_type=pool.source_type,
            period_start=pool.period_start,
            period_end=pool.period_end,
            currency_code=pool.currency_code,
        )
        if fact is None:
            raise AppError(
                "RECOGNITION_REQUIRED",
                "Pool freeze requires recognized revenue",
                409,
                "Staff cannot type a pool total that has no recognized-revenue support",
            )
        if fact.money.currency_code != pool.currency_code:
            raise AppError("CURRENCY_MISMATCH", "Recognized revenue currency does not match pool", 409)
        previous = pool.status
        pool.amount_minor = fact.money.amount_minor
        pool.funding_intake_id = fact.intake_id
        pool.status = "FROZEN"
        pool.updated_by = ctx.user_id
        await self._flush()
        await self._emit(
            ctx,
            event_type=REVENUE_POOL_FROZEN,
            aggregate_type="RevenuePool",
            aggregate_id=pool.id,
            payload={"amount_minor": pool.amount_minor, "currency_code": pool.currency_code},
            organization_id=org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="revenue_pool.frozen",
            entity_type="RevenuePool",
            entity_id=pool.id,
            previous_state={"status": previous, "amount_minor": 0},
            new_state={"status": pool.status, "amount_minor": pool.amount_minor},
            organization_id=org_id,
        )
        return pool

    async def list_pools(self, ctx: AuthContext) -> list[RevenuePool]:
        org_id = self._workspace(ctx)
        await self._staff(ctx, "royalty.read", org_id)
        stmt = select(RevenuePool).where(
            or_(RevenuePool.organization_id == org_id, RevenuePool.organization_id.is_(None))
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def _playback_facts(self, pool: RevenuePool) -> list[PlaybackFact]:
        rows = (
            await self.session.execute(
                select(PlaybackEvent).where(
                    PlaybackEvent.started_at >= pool.period_start,
                    PlaybackEvent.started_at < pool.period_end,
                )
            )
        ).scalars().all()
        return [
            PlaybackFact(
                playback_event_id=row.id,
                track_id=row.track_id,
                user_id=row.user_id,
                started_at=row.started_at,
                duration_ms=row.duration_ms,
                completed=row.completed,
                ignored=row.ignored,
            )
            for row in rows
        ]

    async def _purchase_units(self, pool: RevenuePool) -> dict[UUID, int]:
        rows = (
            await self.session.execute(
                select(OrderItem.ref_id, func.coalesce(func.sum(OrderItem.quantity), 0))
                .join(Order, Order.id == OrderItem.order_id)
                .where(
                    Order.purpose == "TRACK",
                    Order.status == "FULFILLED",
                    OrderItem.item_type == "TRACK",
                    Order.updated_at >= pool.period_start,
                    Order.updated_at < pool.period_end,
                    Order.deleted_at.is_(None),
                )
                .group_by(OrderItem.ref_id)
            )
        ).all()
        return {track_id: int(qty) for track_id, qty in rows}

    async def _shares_for_track(
        self,
        track_id: UUID,
        right_type: str,
        as_of: datetime,
    ) -> tuple[list[ShareSlice], ResidualPayee | None]:
        rights_rows = (
            await self.session.execute(
                select(Rights).where(Rights.track_id == track_id, Rights.status == "ACTIVE")
            )
        ).scalars().all()
        if not rights_rows:
            return [], None
        slices: list[ShareSlice] = []
        residual = None
        for rights in rights_rows:
            shares = (
                await self.session.execute(
                    select(RightShare).where(
                        RightShare.rights_id == rights.id,
                        RightShare.right_type == right_type,
                    )
                )
            ).scalars().all()
            active = [row for row in shares if self._share_active(row, as_of)]
            for row in active:
                slices.append(
                    ShareSlice(
                        right_share_id=row.id,
                        rights_id=rights.id,
                        right_type=row.right_type,
                        payee_type=row.payee_type,
                        payee_id=row.payee_id,
                        share_bps=row.share_bps,
                    )
                )
            residual = self._residual(rights, right_type)
        return slices, residual

    async def start_run(self, ctx: AuthContext, pool_id: UUID, *, run_kind: str = "PRIMARY") -> Royalty:
        pool = await self.session.get(RevenuePool, pool_id)
        if pool is None:
            raise NotFoundError("Revenue pool not found")
        org_id = pool.organization_id or self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        if run_kind not in RUN_KINDS:
            raise AppError("VALIDATION_ERROR", "Unknown run_kind", 422)
        if pool.status != "FROZEN" and not (run_kind == "CORRECTION" and pool.status in {"ALLOCATED", "CLOSED"}):
            raise AppError("INVALID_TRANSITION", "Run requires a frozen pool", 409)
        rule = await self.session.get(RoyaltyRule, pool.rule_id)
        if rule is None or rule.status != "ACTIVE":
            raise AppError("RULE_INACTIVE", "Pool rule must be ACTIVE", 409)
        if run_kind == "PRIMARY":
            existing = (
                await self.session.execute(
                    select(Royalty).where(
                        Royalty.revenue_pool_id == pool.id,
                        Royalty.rule_id == rule.id,
                        Royalty.run_kind == "PRIMARY",
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                if existing.status != "CALCULATING":
                    return existing
                return await self.complete_run(ctx, existing.id)
        run = Royalty(
            revenue_pool_id=pool.id,
            status="CALCULATING",
            rule_id=rule.id,
            run_kind=run_kind,
            pool_amount_minor_snapshot=pool.amount_minor,
            rule_key_snapshot=rule.key,
            rule_version_snapshot=rule.version_number,
            rule_definition_snapshot=dict(rule.definition),
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(run)
        await self._flush()
        await self._emit(
            ctx,
            event_type=ROYALTY_CALCULATION_STARTED,
            aggregate_type="Royalty",
            aggregate_id=run.id,
            payload={"revenue_pool_id": str(pool.id), "run_kind": run_kind},
            organization_id=org_id,
        )
        return await self.complete_run(ctx, run.id)

    async def complete_run(self, ctx: AuthContext | None, run_id: UUID) -> Royalty:
        run = await self.session.get(Royalty, run_id)
        if run is None:
            raise NotFoundError("Royalty run not found")
        if run.status != "CALCULATING":
            return run
        pool = await self.session.get(RevenuePool, run.revenue_pool_id)
        if pool is None:
            raise NotFoundError("Revenue pool not found")
        definition = run.rule_definition_snapshot or {}
        pool_type = str(definition.get("pool_type") or "")
        if pool_type not in SUPPORTED_POOL_TYPES:
            raise AppError(
                "UNSUPPORTED_RULE",
                "This RoyaltyRule template is not executable",
                409,
                "MANUAL_ALLOCATION is not implemented; do not invent line amounts",
            )
        right_type = str(definition.get("right_type") or "").strip()
        if not right_type:
            raise AppError("RULE_INCOMPLETE", "right_type missing from rule snapshot", 409)
        share_effective = str(definition.get("share_effective") or "PLAY_TIME")
        as_of = pool.period_end if share_effective == "PERIOD_END" else None
        units: dict[UUID, int] = {}
        eligibility_snap: dict[str, Any]
        if pool_type in {"PRO_RATA_BY_ELIGIBLE_PLAY", "PRO_RATA_BY_TIME"}:
            policy = parse_eligibility(definition)
            if policy is None:
                units = {}
                eligibility_snap = {"status": "NON_PAYABLE", "reason": "eligibility policy missing"}
            else:
                facts = await self._playback_facts(pool)
                eligibility_snap = {
                    "min_duration_ms": policy.min_duration_ms,
                    "require_completed": policy.require_completed,
                    "unique_listener": policy.unique_listener,
                    "exclude_owner_plays": policy.exclude_owner_plays,
                    "exclude_ignored": policy.exclude_ignored,
                    "fact_count": len(facts),
                }
                if pool_type == "PRO_RATA_BY_TIME":
                    units = eligible_time_by_track(facts, policy)
                else:
                    units = eligible_units_by_track(facts, policy)
        else:
            units = await self._purchase_units(pool)
            eligibility_snap = {"source": "FULFILLED_TRACK_ORDERS", "tracks": len(units)}
        shares_by_track: dict[UUID, list[ShareSlice]] = {}
        residual_by_track: dict[UUID, ResidualPayee | None] = {}
        moment = as_of or pool.period_end
        for track_id in units:
            shares, residual = await self._shares_for_track(track_id, right_type, moment)
            shares_by_track[track_id] = shares
            residual_by_track[track_id] = residual
        lines, unallocated, payable, non_payable = allocate_pool(
            pool_minor=run.pool_amount_minor_snapshot,
            units_by_track=units,
            shares_by_track=shares_by_track,
            residual_by_track=residual_by_track,
        )
        for draft in lines:
            self.session.add(
                RoyaltyLine(
                    royalty_id=run.id,
                    payee_type=draft.payee_type,
                    payee_id=draft.payee_id,
                    track_id=draft.track_id,
                    rights_id=draft.rights_id,
                    right_share_id=draft.right_share_id,
                    right_type=draft.right_type,
                    revenue_pool_id=pool.id,
                    rule_id=run.rule_id,
                    eligible_units=draft.eligible_units,
                    share_bps_snapshot=draft.share_bps_snapshot,
                    amount_minor=draft.amount_minor,
                    currency_code=pool.currency_code,
                    is_residual=draft.is_residual,
                )
            )
        run.unallocated_minor = unallocated
        run.eligibility_snapshot = eligibility_snap
        run.units_snapshot = {
            "payable": {str(k): v for k, v in payable.items()},
            "non_payable": {str(k): v for k, v in non_payable.items()},
        }
        royalty_transition_action(run.status, "CALCULATED")
        run.status = "CALCULATED"
        await self._flush()
        org_id = pool.organization_id
        await self._emit(
            ctx,
            event_type=ROYALTY_CALCULATION_COMPLETED,
            aggregate_type="Royalty",
            aggregate_id=run.id,
            payload={
                "unallocated_minor": run.unallocated_minor,
                "line_count": len(lines),
            },
            organization_id=org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="royalty.calculated",
            entity_type="Royalty",
            entity_id=run.id,
            new_state={"status": run.status, "unallocated_minor": run.unallocated_minor},
            organization_id=org_id,
        )
        return run

    async def transition_run(self, ctx: AuthContext, run_id: UUID, action: str) -> Royalty:
        run = await self.session.get(Royalty, run_id)
        if run is None:
            raise NotFoundError("Royalty run not found")
        pool = await self.session.get(RevenuePool, run.revenue_pool_id)
        if pool is None:
            raise NotFoundError("Revenue pool not found")
        org_id = pool.organization_id or self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        targets = {"approve": "APPROVED", "post": "POSTED"}
        target = targets.get(action)
        if target is None:
            raise AppError("INVALID_TRANSITION", "Unknown run action", 422)
        royalty_transition_action(run.status, target)
        if run.unallocated_minor > 0:
            raise AppError(
                "UNALLOCATED_REMAINDER",
                "Cannot approve or post a run with unallocated remainder",
                409,
                "Residual payee is stored data; do not invent a remainder recipient",
            )
        previous = run.status
        run.status = target
        run.updated_by = ctx.user_id
        if target == "POSTED":
            lines = list(
                (
                    await self.session.execute(select(RoyaltyLine).where(RoyaltyLine.royalty_id == run.id))
                ).scalars().all()
            )
            total = sum(row.amount_minor for row in lines)
            await self._accrual_port(org_id).accrue(
                royalty_id=run.id,
                revenue_pool_id=pool.id,
                amount_minor=total,
                currency_code=pool.currency_code,
                actor_id=ctx.user_id,
                correlation_id=ctx.request_id,
                payload={"run_kind": run.run_kind},
            )
            if pool.status == "FROZEN":
                pool_transition_action(pool.status, "ALLOCATED")
                pool.status = "ALLOCATED"
                pool.updated_by = ctx.user_id
            await self._generate_statements(ctx, run, pool, lines)
            await self._emit(
                ctx,
                event_type=ROYALTY_GENERATED,
                aggregate_type="Royalty",
                aggregate_id=run.id,
                payload={"amount_minor": total, "currency_code": pool.currency_code},
                organization_id=org_id,
            )
        if target == "APPROVED":
            await self._emit(
                ctx,
                event_type=ROYALTY_APPROVED,
                aggregate_type="Royalty",
                aggregate_id=run.id,
                payload={"status": run.status},
                organization_id=org_id,
            )
        await self._flush()
        await self.audit.record_from_auth(
            ctx,
            action=f"royalty.{action}",
            entity_type="Royalty",
            entity_id=run.id,
            previous_state={"status": previous},
            new_state={"status": run.status},
            organization_id=org_id,
        )
        return run

    async def _generate_statements(
        self,
        ctx: AuthContext,
        run: Royalty,
        pool: RevenuePool,
        lines: list[RoyaltyLine],
    ) -> list[RoyaltyStatement]:
        grouped: dict[tuple[str, UUID], int] = {}
        for line in lines:
            key = (line.payee_type, line.payee_id)
            grouped[key] = grouped.get(key, 0) + line.amount_minor
        statements: list[RoyaltyStatement] = []
        for (payee_type, payee_id), total in grouped.items():
            latest = (
                await self.session.execute(
                    select(func.max(RoyaltyStatement.version_number)).where(
                        RoyaltyStatement.payee_type == payee_type,
                        RoyaltyStatement.payee_id == payee_id,
                        RoyaltyStatement.period_start == pool.period_start,
                        RoyaltyStatement.period_end == pool.period_end,
                    )
                )
            ).scalar_one()
            version_number = int(latest or 0) + 1
            row = RoyaltyStatement(
                payee_type=payee_type,
                payee_id=payee_id,
                period_start=pool.period_start,
                period_end=pool.period_end,
                status="DRAFT",
                total_amount_minor=total,
                currency_code=pool.currency_code,
                version_number=version_number,
                royalty_id=run.id,
                created_by=ctx.user_id,
                updated_by=ctx.user_id,
            )
            self.session.add(row)
            statements.append(row)
        await self._flush()
        return statements

    async def issue_statement(self, ctx: AuthContext, statement_id: UUID) -> RoyaltyStatement:
        statement = await self.session.get(RoyaltyStatement, statement_id)
        if statement is None:
            raise NotFoundError("Statement not found")
        org_id = self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        statement_transition_action(statement.status, "ISSUED")
        previous = statement.status
        statement.status = "ISSUED"
        statement.updated_by = ctx.user_id
        await self._flush()
        await self._emit(
            ctx,
            event_type=ROYALTY_STATEMENT_ISSUED,
            aggregate_type="RoyaltyStatement",
            aggregate_id=statement.id,
            payload={
                "payee_type": statement.payee_type,
                "payee_id": str(statement.payee_id),
                "total_amount_minor": statement.total_amount_minor,
                "currency_code": statement.currency_code,
            },
            organization_id=org_id,
        )
        user_id = await self._notify_user_id(statement.payee_type, statement.payee_id)
        if user_id is not None:
            await self.notifications.request(
                user_id=user_id,
                notification_type="royalty.statement_issued",
                title="Royalty statement available",
                body="A royalty statement is available.",
            )
        await self.audit.record_from_auth(
            ctx,
            action="royalty_statement.issued",
            entity_type="RoyaltyStatement",
            entity_id=statement.id,
            previous_state={"status": previous},
            new_state={"status": statement.status},
            organization_id=org_id,
        )
        return statement

    async def _notify_user_id(self, payee_type: str, payee_id: UUID) -> UUID | None:
        if payee_type == "USER":
            return payee_id
        if payee_type == "ARTIST":
            artist = await self.session.get(Artist, payee_id)
            if artist is not None:
                return artist.claimed_user_id
        return None

    async def transition_statement(self, ctx: AuthContext, statement_id: UUID, action: str) -> RoyaltyStatement:
        statement = await self.session.get(RoyaltyStatement, statement_id)
        if statement is None:
            raise NotFoundError("Statement not found")
        if action == "issue":
            return await self.issue_statement(ctx, statement_id)
        is_payee = await self._is_payee(ctx.user_id, statement.payee_type, statement.payee_id)
        if not is_payee:
            try:
                await self._staff(ctx, "royalty.run", self._workspace(ctx))
            except (NotFoundError, AppError) as exc:
                raise NotFoundError("Statement not found") from exc
        targets = {"acknowledge": "ACKNOWLEDGED", "dispute": "DISPUTED"}
        target = targets.get(action)
        if target is None:
            raise AppError("INVALID_TRANSITION", "Unknown statement action", 422)
        statement_transition_action(statement.status, target)
        previous = statement.status
        statement.status = target
        statement.updated_by = ctx.user_id
        await self._flush()
        await self.audit.record_from_auth(
            ctx,
            action=f"royalty_statement.{action}",
            entity_type="RoyaltyStatement",
            entity_id=statement.id,
            previous_state={"status": previous},
            new_state={"status": statement.status},
        )
        return statement

    async def add_adjustment(
        self,
        ctx: AuthContext,
        statement_id: UUID,
        *,
        amount_minor: int,
        reason: str,
    ) -> RoyaltyAdjustment:
        statement = await self.session.get(RoyaltyStatement, statement_id)
        if statement is None:
            raise NotFoundError("Statement not found")
        org_id = self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        if statement.status != "ISSUED":
            raise AppError(
                "INVALID_TRANSITION",
                "Adjustments apply to issued statements",
                409,
                "Issued statements are immutable; adjustments are additive",
            )
        adj = RoyaltyAdjustment(
            statement_id=statement.id,
            payee_type=statement.payee_type,
            payee_id=statement.payee_id,
            amount_minor=amount_minor,
            currency_code=statement.currency_code,
            reason=reason.strip(),
            status="POSTED",
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        if not adj.reason:
            raise AppError("VALIDATION_ERROR", "Adjustment reason is required", 422)
        self.session.add(adj)
        await self._flush()
        await self._emit(
            ctx,
            event_type=ROYALTY_STATEMENT_ADJUSTED,
            aggregate_type="RoyaltyStatement",
            aggregate_id=statement.id,
            payload={"amount_minor": amount_minor, "adjustment_id": str(adj.id)},
            organization_id=org_id,
        )
        user_id = await self._notify_user_id(statement.payee_type, statement.payee_id)
        if user_id is not None:
            await self.notifications.request(
                user_id=user_id,
                notification_type="royalty.statement_adjusted",
                title="Royalty statement adjusted",
                body="A royalty statement was adjusted.",
            )
        await self.audit.record_from_auth(
            ctx,
            action="royalty_statement.adjusted",
            entity_type="RoyaltyAdjustment",
            entity_id=adj.id,
            new_state={"amount_minor": amount_minor, "statement_id": str(statement.id)},
            organization_id=org_id,
        )
        return adj

    async def get_statement(self, ctx: AuthContext, statement_id: UUID) -> tuple[RoyaltyStatement, list[RoyaltyLine], list[RoyaltyAdjustment]]:
        statement = await self.session.get(RoyaltyStatement, statement_id)
        if statement is None:
            raise NotFoundError("Statement not found")
        is_payee = await self._is_payee(ctx.user_id, statement.payee_type, statement.payee_id)
        if not is_payee:
            try:
                org_id = self._workspace(ctx)
                await self._staff(ctx, "royalty.read", org_id)
            except (NotFoundError, AppError) as exc:
                raise NotFoundError("Statement not found") from exc
        lines: list[RoyaltyLine] = []
        if statement.royalty_id is not None:
            lines = list(
                (
                    await self.session.execute(
                        select(RoyaltyLine).where(
                            RoyaltyLine.royalty_id == statement.royalty_id,
                            RoyaltyLine.payee_type == statement.payee_type,
                            RoyaltyLine.payee_id == statement.payee_id,
                        )
                    )
                ).scalars().all()
            )
        adjustments = list(
            (
                await self.session.execute(
                    select(RoyaltyAdjustment).where(RoyaltyAdjustment.statement_id == statement.id)
                )
            ).scalars().all()
        )
        return statement, lines, adjustments

    async def list_my_statements(
        self, ctx: AuthContext, *, cursor: str | None = None, limit: int = 50
    ) -> tuple[list[RoyaltyStatement], str | None]:
        artist_ids = await self.claimed_artist_ids(ctx.user_id)
        clauses = [and_(RoyaltyStatement.payee_type == "USER", RoyaltyStatement.payee_id == ctx.user_id)]
        if artist_ids:
            clauses.append(
                and_(RoyaltyStatement.payee_type == "ARTIST", RoyaltyStatement.payee_id.in_(artist_ids))
            )
        stmt: Select[tuple[RoyaltyStatement]] = select(RoyaltyStatement).where(or_(*clauses)).order_by(
            RoyaltyStatement.created_at.desc(), RoyaltyStatement.id.desc()
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(RoyaltyStatement.created_at < data["t"])
        size = clamp_limit(limit)
        rows = list((await self.session.execute(stmt.limit(size + 1))).scalars().all())
        next_cursor = None
        if len(rows) > size:
            last = rows[size - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:size]
        return rows, next_cursor

    async def create_settlement(self, ctx: AuthContext, statement_id: UUID) -> Settlement:
        statement, _lines, adjustments = await self.get_statement(ctx, statement_id)
        org_id = self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        if statement.status != "ISSUED":
            raise AppError("INVALID_TRANSITION", "Settlement requires an issued statement", 409)
        net = statement.total_amount_minor + sum(row.amount_minor for row in adjustments)
        if net < 0:
            raise AppError("INVALID_AMOUNT", "Settlement amount cannot be negative", 409)
        settlement = Settlement(
            kind="ROYALTY",
            payee_type=statement.payee_type,
            payee_id=statement.payee_id,
            status="CALCULATED",
            amount_minor=net,
            currency_code=statement.currency_code,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(settlement)
        await self._flush()
        self.session.add(
            SettlementLine(
                settlement_id=settlement.id,
                source_type="ROYALTY_STATEMENT",
                source_id=statement.id,
                amount_minor=net,
            )
        )
        await self._flush()
        await self.audit.record_from_auth(
            ctx,
            action="settlement.calculated",
            entity_type="Settlement",
            entity_id=settlement.id,
            new_state={"amount_minor": net, "status": settlement.status},
            organization_id=org_id,
        )
        return settlement

    async def approve_settlement(self, ctx: AuthContext, settlement_id: UUID) -> Settlement:
        settlement = await self.session.get(Settlement, settlement_id)
        if settlement is None:
            raise NotFoundError("Settlement not found")
        org_id = self._workspace(ctx)
        await self._staff(ctx, "royalty.run", org_id)
        settlement_transition_action(settlement.status, "APPROVED")
        previous = settlement.status
        settlement.status = "APPROVED"
        settlement.updated_by = ctx.user_id
        await self._flush()
        await self._emit(
            ctx,
            event_type=SETTLEMENT_APPROVED,
            aggregate_type="Settlement",
            aggregate_id=settlement.id,
            payload={"amount_minor": settlement.amount_minor, "currency_code": settlement.currency_code},
            organization_id=org_id,
        )
        await self.audit.record_from_auth(
            ctx,
            action="settlement.approved",
            entity_type="Settlement",
            entity_id=settlement.id,
            previous_state={"status": previous},
            new_state={"status": settlement.status},
            organization_id=org_id,
        )
        return settlement

    async def get_run(self, ctx: AuthContext, run_id: UUID) -> tuple[Royalty, list[RoyaltyLine]]:
        run = await self.session.get(Royalty, run_id)
        if run is None:
            raise NotFoundError("Royalty run not found")
        pool = await self.session.get(RevenuePool, run.revenue_pool_id)
        org_id = (pool.organization_id if pool else None) or self._workspace(ctx)
        await self._staff(ctx, "royalty.read", org_id)
        lines = list(
            (await self.session.execute(select(RoyaltyLine).where(RoyaltyLine.royalty_id == run.id))).scalars().all()
        )
        return run, lines
