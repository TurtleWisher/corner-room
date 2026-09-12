"""Subscriptions application service. Periods snapshot plan version amounts."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.calendar import add_billing_interval
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    SUBSCRIPTION_CANCELLED,
    SUBSCRIPTION_PAST_DUE,
    SUBSCRIPTION_RENEWED,
    SUBSCRIPTION_STARTED,
    DomainEvent,
)
from cornerroom.kernel.money import Money
from cornerroom.kernel.pagination import clamp_limit
from cornerroom.kernel.ports import NotificationPort, NullNotificationPort
from cornerroom.kernel.recurring import RecurringBillingPort, RecurringPeriodRequest, SandboxRecurringBilling
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.entitlements.application.service import EntitlementService
from cornerroom.modules.identity.domain.models import Organization
from cornerroom.modules.subscriptions.domain.lifecycle import (
    NON_TERMINAL_SUBSCRIPTION,
    initial_subscription_status,
    period_end,
    period_transition_action,
    plan_transition_action,
    subscription_transition_action,
)
from cornerroom.modules.subscriptions.domain.models import (
    Subscription,
    SubscriptionPeriod,
    SubscriptionPlan,
    SubscriptionPlanVersion,
)


class SubscriptionService:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
        recurring: RecurringBillingPort | None = None,
        notifications: NotificationPort | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)
        self.notifications = notifications or NullNotificationPort()
        self.entitlements = EntitlementService(session, clock=self.clock, notifications=self.notifications)
        self.recurring = recurring or SandboxRecurringBilling()

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
            producer="subscriptions",
            aggregate_type="Subscription",
            aggregate_id=aggregate_id,
            payload=payload,
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id if ctx else None,
            organization_id=organization_id,
            correlation_id=ctx.request_id if ctx else None,
        )
        await enqueue_outbox(self.session, domain)

    async def _require_plan_write(self, ctx: AuthContext, organization_id: UUID, plan_id: UUID) -> None:
        org = await self.session.get(Organization, organization_id)
        if org is None or org.deleted_at is not None or org.status != "ACTIVE":
            raise AppError("ORGANIZATION_NOT_ACTIVE", "Organization is not active", 409)
        await self.authz.authorize(
            ctx.user_id,
            "commerce.write",
            resource_type="subscription_plan",
            resource_id=plan_id,
            scope_organization_id=organization_id,
        )

    async def create_plan(
        self,
        ctx: AuthContext,
        *,
        key: str,
        price_amount_minor: int,
        currency_code: str,
        interval: str,
        interval_count: int = 1,
        trial_days: int | None = None,
        features: dict | None = None,
        organization_id: UUID | None = None,
    ) -> SubscriptionPlan:
        org_id = organization_id or ctx.organization_id
        if org_id is None:
            raise AppError("WORKSPACE_REQUIRED", "An active organization is required", 409)
        await self.authz.authorize(
            ctx.user_id,
            "commerce.write",
            resource_type="organization",
            resource_id=org_id,
            scope_organization_id=org_id,
        )
        money = Money(amount_minor=price_amount_minor, currency_code=currency_code)
        if interval_count < 1:
            raise AppError("VALIDATION_ERROR", "interval_count must be >= 1", 422)
        # Validate interval without inventing a length.
        add_billing_interval(self.clock.now(), interval, interval_count)
        existing = (
            await self.session.execute(
                select(SubscriptionPlan).where(
                    SubscriptionPlan.key == key.strip(),
                    SubscriptionPlan.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise AppError("CONFLICT", "Plan key already exists", 409)
        plan = SubscriptionPlan(
            organization_id=org_id,
            key=key.strip(),
            status="DRAFT",
            price_amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            interval=interval.upper(),
            interval_count=interval_count,
            features=features,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(plan)
        await self.session.flush()
        version = SubscriptionPlanVersion(
            plan_id=plan.id,
            version_number=1,
            price_amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            interval=plan.interval,
            interval_count=interval_count,
            trial_days=trial_days,
            features=features,
            created_by=ctx.user_id,
        )
        self.session.add(version)
        await self.session.flush()
        plan.current_version_id = version.id
        await self.audit.record_from_auth(
            ctx,
            action="subscription_plan.created",
            entity_type="SubscriptionPlan",
            entity_id=plan.id,
            new_state={"status": plan.status, "key": plan.key},
            organization_id=org_id,
        )
        return plan

    async def add_plan_version(
        self,
        ctx: AuthContext,
        plan_id: UUID,
        *,
        price_amount_minor: int,
        currency_code: str,
        interval: str,
        interval_count: int = 1,
        trial_days: int | None = None,
        features: dict | None = None,
    ) -> SubscriptionPlanVersion:
        plan = await self.session.get(SubscriptionPlan, plan_id)
        if plan is None or plan.deleted_at is not None:
            raise NotFoundError("Plan not found")
        await self._require_plan_write(ctx, plan.organization_id, plan.id)
        money = Money(amount_minor=price_amount_minor, currency_code=currency_code)
        add_billing_interval(self.clock.now(), interval, interval_count)
        latest = (
            await self.session.execute(
                select(SubscriptionPlanVersion)
                .where(SubscriptionPlanVersion.plan_id == plan.id)
                .order_by(SubscriptionPlanVersion.version_number.desc())
            )
        ).scalars().first()
        number = 1 if latest is None else latest.version_number + 1
        version = SubscriptionPlanVersion(
            plan_id=plan.id,
            version_number=number,
            price_amount_minor=money.amount_minor,
            currency_code=money.currency_code,
            interval=interval.upper(),
            interval_count=interval_count,
            trial_days=trial_days,
            features=features,
            created_by=ctx.user_id,
        )
        self.session.add(version)
        await self.session.flush()
        plan.price_amount_minor = money.amount_minor
        plan.currency_code = money.currency_code
        plan.interval = version.interval
        plan.interval_count = version.interval_count
        plan.features = features
        plan.current_version_id = version.id
        plan.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="subscription_plan.version_added",
            entity_type="SubscriptionPlan",
            entity_id=plan.id,
            new_state={
                "version_number": version.version_number,
                "price_amount_minor": version.price_amount_minor,
            },
            organization_id=plan.organization_id,
        )
        return version

    async def transition_plan(self, ctx: AuthContext, plan_id: UUID, *, action: str) -> SubscriptionPlan:
        plan = await self.session.get(SubscriptionPlan, plan_id)
        if plan is None or plan.deleted_at is not None:
            raise NotFoundError("Plan not found")
        await self._require_plan_write(ctx, plan.organization_id, plan.id)
        target = {"activate": "ACTIVE", "retire": "RETIRED"}.get(action)
        if target is None:
            raise AppError("VALIDATION_ERROR", "Unknown plan action", 422)
        if target == "ACTIVE" and plan.current_version_id is None:
            raise AppError("PLAN_VERSION_REQUIRED", "A plan version is required before activation", 409)
        plan_transition_action(plan.status, target)
        plan.status = target
        plan.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action=f"subscription_plan.{action}",
            entity_type="SubscriptionPlan",
            entity_id=plan.id,
            new_state={"status": plan.status},
            organization_id=plan.organization_id,
        )
        return plan

    async def list_active_plans(self) -> list[tuple[SubscriptionPlan, SubscriptionPlanVersion]]:
        stmt = (
            select(SubscriptionPlan)
            .where(
                SubscriptionPlan.status == "ACTIVE",
                SubscriptionPlan.deleted_at.is_(None),
            )
            .order_by(SubscriptionPlan.created_at.desc())
        )
        plans = list((await self.session.execute(stmt)).scalars())
        out: list[tuple[SubscriptionPlan, SubscriptionPlanVersion]] = []
        for plan in plans:
            if plan.current_version_id is None:
                continue
            version = await self.session.get(SubscriptionPlanVersion, plan.current_version_id)
            if version is not None:
                out.append((plan, version))
        return out

    async def get_active_plan(self, plan_id: UUID) -> tuple[SubscriptionPlan, SubscriptionPlanVersion]:
        plan = await self.session.get(SubscriptionPlan, plan_id)
        if plan is None or plan.deleted_at is not None or plan.status != "ACTIVE":
            raise NotFoundError("Plan not found")
        if plan.current_version_id is None:
            raise AppError("PLAN_VERSION_REQUIRED", "Plan has no current version", 409)
        version = await self.session.get(SubscriptionPlanVersion, plan.current_version_id)
        if version is None:
            raise AppError("PLAN_VERSION_REQUIRED", "Plan has no current version", 409)
        return plan, version

    async def active_for_user(self, user_id: UUID) -> Subscription | None:
        return (
            await self.session.execute(
                select(Subscription).where(
                    Subscription.user_id == user_id,
                    Subscription.status.in_(tuple(NON_TERMINAL_SUBSCRIPTION)),
                    Subscription.deleted_at.is_(None),
                )
            )
        ).scalars().first()

    async def get_subscription_row(self, subscription_id: UUID) -> Subscription:
        row = await self.session.get(Subscription, subscription_id)
        if row is None or row.deleted_at is not None:
            raise NotFoundError("Subscription not found")
        return row

    async def get_own(self, ctx: AuthContext, subscription_id: UUID) -> Subscription:
        row = await self.session.get(Subscription, subscription_id)
        if row is None or row.deleted_at is not None or row.user_id != ctx.user_id:
            raise NotFoundError("Subscription not found")
        return row

    async def get_mine(self, ctx: AuthContext) -> Subscription:
        row = await self.active_for_user(ctx.user_id)
        if row is None:
            raise NotFoundError("Subscription not found")
        return row

    async def start_from_fulfillment(
        self,
        ctx: AuthContext | None,
        *,
        user_id: UUID,
        plan_version_id: UUID,
        order_id: UUID,
        organization_id: UUID | None,
    ) -> Subscription:
        existing = (
            await self.session.execute(
                select(Subscription).where(
                    Subscription.user_id == user_id,
                    Subscription.status.in_(tuple(NON_TERMINAL_SUBSCRIPTION)),
                    Subscription.deleted_at.is_(None),
                )
            )
        ).scalars().first()
        version = await self.session.get(SubscriptionPlanVersion, plan_version_id)
        if version is None:
            raise AppError("PLAN_VERSION_REQUIRED", "Plan version missing", 409)
        if existing is not None:
            if existing.plan_version_id == plan_version_id:
                return existing
            raise AppError(
                "SUBSCRIPTION_EXISTS",
                "A non-terminal subscription already exists",
                409,
                "Family plans are P1 (Q-P1-27 / Q-P9-10)",
            )
        now = self.clock.now()
        status = initial_subscription_status(version.trial_days)
        ends = period_end(
            starts_at=now,
            interval=version.interval,
            interval_count=version.interval_count,
            trial_days=version.trial_days,
            status=status,
        )
        sub = Subscription(
            user_id=user_id,
            plan_id=version.plan_id,
            plan_version_id=version.id,
            status=status,
            created_by=user_id,
            updated_by=user_id,
        )
        self.session.add(sub)
        await self.session.flush()
        period = SubscriptionPeriod(
            subscription_id=sub.id,
            plan_version_id=version.id,
            starts_at=now,
            ends_at=ends,
            status="PAID",
            amount_minor=version.price_amount_minor,
            currency_code=version.currency_code,
            order_id=order_id,
            created_by=user_id,
        )
        self.session.add(period)
        await self.session.flush()
        sub.current_period_id = period.id
        await self.entitlements.grant(
            ctx,
            user_id=user_id,
            entitlement_type="SUBSCRIPTION",
            ref_id=sub.id,
            scope="CATALOG",
            expires_at=period.ends_at,
            source_type="ORDER",
            source_id=order_id,
            organization_id=organization_id,
            actor_id=user_id,
        )
        await self._emit(
            ctx,
            event_type=SUBSCRIPTION_STARTED,
            aggregate_id=sub.id,
            organization_id=organization_id,
            payload={
                "subscription_id": str(sub.id),
                "plan_version_id": str(version.id),
                "status": sub.status,
                "period_ends_at": period.ends_at.isoformat(),
            },
        )
        await self.notifications.request(
            user_id=user_id,
            notification_type="subscription.started",
            title="Subscription started",
            body="Your subscription is active for the current period.",
        )
        return sub

    async def cancel(self, ctx: AuthContext, subscription_id: UUID) -> Subscription:
        sub = await self.get_own(ctx, subscription_id)
        if sub.status in {"CANCELLED", "EXPIRED"}:
            return sub
        subscription_transition_action(sub.status, "CANCELLED")
        sub.status = "CANCELLED"
        sub.cancel_at_period_end = True
        sub.cancelled_at = self.clock.now()
        sub.updated_by = ctx.user_id
        await self.session.flush()
        # Entitled until current period end (Q-P9-08). Do not invent an extra window.
        await self._emit(
            ctx,
            event_type=SUBSCRIPTION_CANCELLED,
            aggregate_id=sub.id,
            payload={
                "subscription_id": str(sub.id),
                "cancel_at_period_end": True,
            },
        )
        await self.audit.record_from_auth(
            ctx,
            action="subscription.cancelled",
            entity_type="Subscription",
            entity_id=sub.id,
            new_state={"status": sub.status},
        )
        await self.notifications.request(
            user_id=sub.user_id,
            notification_type="subscription.cancelled",
            title="Subscription cancelled",
            body="Access continues until the current period ends (Q-P9-08).",
        )
        return sub

    async def mark_past_due(self, ctx: AuthContext | None, subscription_id: UUID) -> Subscription:
        sub = await self.session.get(Subscription, subscription_id)
        if sub is None:
            raise NotFoundError("Subscription not found")
        if sub.status == "PAST_DUE":
            return sub
        subscription_transition_action(sub.status, "PAST_DUE")
        sub.status = "PAST_DUE"
        await self.session.flush()
        if sub.current_period_id is not None:
            period = await self.session.get(SubscriptionPeriod, sub.current_period_id)
            if period is not None and period.status == "OPEN":
                period_transition_action(period.status, "UNPAID")
                period.status = "UNPAID"
        await self._emit(
            ctx,
            event_type=SUBSCRIPTION_PAST_DUE,
            aggregate_id=sub.id,
            payload={"subscription_id": str(sub.id)},
        )
        return sub

    async def renew_from_fulfillment(
        self,
        ctx: AuthContext | None,
        *,
        subscription_id: UUID,
        plan_version_id: UUID,
        order_id: UUID,
        organization_id: UUID | None,
    ) -> Subscription:
        sub = await self.session.get(Subscription, subscription_id)
        if sub is None or sub.deleted_at is not None:
            raise NotFoundError("Subscription not found")
        version = await self.session.get(SubscriptionPlanVersion, plan_version_id)
        if version is None:
            raise AppError("PLAN_VERSION_REQUIRED", "Plan version missing", 409)
        now = self.clock.now()
        existing_period = (
            await self.session.execute(
                select(SubscriptionPeriod).where(
                    SubscriptionPeriod.subscription_id == sub.id,
                    SubscriptionPeriod.order_id == order_id,
                )
            )
        ).scalar_one_or_none()
        if existing_period is not None:
            return sub
        starts = now
        if sub.current_period_id is not None:
            current = await self.session.get(SubscriptionPeriod, sub.current_period_id)
            if current is not None and current.ends_at > now:
                starts = current.ends_at
        ends = add_billing_interval(starts, version.interval, version.interval_count)
        duplicate = (
            await self.session.execute(
                select(SubscriptionPeriod).where(
                    SubscriptionPeriod.subscription_id == sub.id,
                    SubscriptionPeriod.starts_at == starts,
                )
            )
        ).scalar_one_or_none()
        if duplicate is not None:
            return sub
        period = SubscriptionPeriod(
            subscription_id=sub.id,
            plan_version_id=version.id,
            starts_at=starts,
            ends_at=ends,
            status="PAID",
            amount_minor=version.price_amount_minor,
            currency_code=version.currency_code,
            order_id=order_id,
            created_by=sub.user_id,
        )
        self.session.add(period)
        await self.session.flush()
        if sub.status == "PAST_DUE":
            subscription_transition_action(sub.status, "ACTIVE")
        elif sub.status == "TRIALING":
            subscription_transition_action(sub.status, "ACTIVE")
        sub.status = "ACTIVE"
        sub.plan_version_id = version.id
        sub.current_period_id = period.id
        await self.session.flush()
        await self.entitlements.grant(
            ctx,
            user_id=sub.user_id,
            entitlement_type="SUBSCRIPTION",
            ref_id=sub.id,
            scope="CATALOG",
            expires_at=period.ends_at,
            source_type="ORDER",
            source_id=order_id,
            organization_id=organization_id,
            actor_id=sub.user_id,
        )
        await self._emit(
            ctx,
            event_type=SUBSCRIPTION_RENEWED,
            aggregate_id=sub.id,
            organization_id=organization_id,
            payload={
                "subscription_id": str(sub.id),
                "period_id": str(period.id),
                "plan_version_id": str(version.id),
            },
        )
        return sub

    def request_renewal_via_port(self, *, subscription: Subscription, version: SubscriptionPlanVersion) -> None:
        """Port call only — does not capture money or fake a production biller."""
        now = self.clock.now()
        self.recurring.request_period(
            RecurringPeriodRequest(
                subscription_id=subscription.id,
                plan_version_id=version.id,
                amount_minor=version.price_amount_minor,
                currency_code=version.currency_code,
                period_starts_at=now,
                period_ends_at=add_billing_interval(now, version.interval, version.interval_count),
                idempotency_key=f"renew:{subscription.id}:{now.date().isoformat()}",
            )
        )

    async def current_period(self, subscription: Subscription) -> SubscriptionPeriod | None:
        if subscription.current_period_id is None:
            return None
        return await self.session.get(SubscriptionPeriod, subscription.current_period_id)

    async def list_org_plans(
        self,
        ctx: AuthContext,
    ) -> list[tuple[SubscriptionPlan, SubscriptionPlanVersion | None]]:
        org_id = ctx.organization_id
        if org_id is None:
            raise AppError("WORKSPACE_REQUIRED", "An active organization is required", 409)
        await self.authz.authorize(
            ctx.user_id,
            "commerce.write",
            resource_type="organization",
            resource_id=org_id,
            scope_organization_id=org_id,
        )
        stmt = (
            select(SubscriptionPlan)
            .where(SubscriptionPlan.organization_id == org_id, SubscriptionPlan.deleted_at.is_(None))
            .order_by(SubscriptionPlan.created_at.desc())
        )
        plans = list((await self.session.execute(stmt)).scalars())
        out: list[tuple[SubscriptionPlan, SubscriptionPlanVersion | None]] = []
        for plan in plans:
            version = None
            if plan.current_version_id is not None:
                version = await self.session.get(SubscriptionPlanVersion, plan.current_version_id)
            out.append((plan, version))
        return out

    async def list_mine(self, ctx: AuthContext, *, limit: int = 20) -> list[Subscription]:
        limit = clamp_limit(limit)
        stmt = (
            select(Subscription)
            .where(Subscription.user_id == ctx.user_id, Subscription.deleted_at.is_(None))
            .order_by(Subscription.created_at.desc())
            .limit(limit)
        )
        return list((await self.session.execute(stmt)).scalars())
