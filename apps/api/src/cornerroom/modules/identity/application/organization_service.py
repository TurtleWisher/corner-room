"""Organization workspace application service. Identity-owned tables; workspace rules here."""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from sqlalchemy import Select, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ConflictError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.security import create_access_token
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    MEMBERSHIP_CHANGED,
    ORGANIZATION_ACTIVATED,
    ORGANIZATION_ARCHIVED,
    ORGANIZATION_INVITATION_ACCEPTED,
    ORGANIZATION_INVITATION_ISSUED,
    ORGANIZATION_INVITATION_REVOKED,
    ORGANIZATION_SUSPENDED,
    DomainEvent,
)
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.authorization.domain.models import Permission, Role, RoleAssignment, RolePermission
from cornerroom.modules.identity.application.credentials import hash_secret, new_opaque_token
from cornerroom.modules.identity.application.org_lifecycle import (
    membership_transition_action,
    target_for_action,
    transition_action,
)
from cornerroom.modules.identity.domain.models import (
    ORG_TYPES,
    Organization,
    OrganizationInvitation,
    OrganizationMembership,
    Session,
    User,
)

EVENT_FOR_ORG_STATUS = {
    "ACTIVE": ORGANIZATION_ACTIVATED,
    "SUSPENDED": ORGANIZATION_SUSPENDED,
    "ARCHIVED": ORGANIZATION_ARCHIVED,
}


def _normalize_email(email: str) -> str:
    return email.strip().lower()


class OrganizationService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        clock: Clock | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)

    async def has_unscoped_permission(self, user_id: UUID, permission: str) -> bool:
        keys = await self.authz.permission_keys(user_id)
        return permission in keys

    async def can_admin_org(self, user_id: UUID, org_id: UUID) -> bool:
        try:
            await self.authz.authorize(
                user_id,
                "org.admin",
                resource_type="organization",
                resource_id=org_id,
            )
            return True
        except ForbiddenError:
            return False

    async def can_see_org(self, user_id: UUID, org_id: UUID) -> bool:
        if await self.can_admin_org(user_id, org_id):
            return True
        return await self._active_membership(user_id, org_id) is not None

    async def can_use_workspace(self, user_id: UUID, org_id: UUID) -> bool:
        org = await self.get_organization(org_id)
        if org.status != "ACTIVE":
            return False
        if await self.has_unscoped_permission(user_id, "org.admin"):
            return True
        if await self.can_admin_org(user_id, org_id):
            return True
        return await self._active_membership(user_id, org_id) is not None

    async def resolve_workspace(self, user_id: UUID, organization_id: UUID | None) -> UUID | None:
        if organization_id is None:
            return None
        try:
            if await self.can_use_workspace(user_id, organization_id):
                return organization_id
        except NotFoundError:
            return None
        return None

    async def get_organization(self, org_id: UUID) -> Organization:
        org = await self.session.get(Organization, org_id)
        if org is None or org.deleted_at is not None:
            raise NotFoundError("Organization not found")
        return org

    async def list_organizations(
        self,
        user_id: UUID,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[Organization], str | None]:
        page = clamp_limit(limit, default=self.settings.pagination_default_limit)
        stmt: Select[tuple[Organization]] = select(Organization).where(
            Organization.deleted_at.is_(None)
        )
        if not await self.has_unscoped_permission(user_id, "org.admin"):
            member_orgs = select(OrganizationMembership.organization_id).where(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.status == "ACTIVE",
                OrganizationMembership.deleted_at.is_(None),
            )
            scoped_orgs = select(RoleAssignment.organization_id).where(
                RoleAssignment.user_id == user_id,
                RoleAssignment.status == "ACTIVE",
                RoleAssignment.deleted_at.is_(None),
                RoleAssignment.organization_id.is_not(None),
            )
            stmt = stmt.where(
                or_(Organization.id.in_(member_orgs), Organization.id.in_(scoped_orgs))
            )
        stmt = stmt.order_by(Organization.created_at.desc(), Organization.id.desc())
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(Organization.created_at < data["t"])
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor

    async def create_organization(
        self,
        ctx: AuthContext,
        *,
        name: str,
        org_type: str,
        share_bps: int | None = None,
    ) -> Organization:
        if not await self.has_unscoped_permission(ctx.user_id, "org.admin"):
            raise ForbiddenError("Missing permission org.admin")
        if org_type not in ORG_TYPES:
            raise AppError("VALIDATION_ERROR", "Invalid type", 422)
        self._assert_share_bps(share_bps)
        org = Organization(
            name=name.strip(),
            type=org_type,
            status="PENDING",
            share_bps=share_bps,
            created_by=ctx.user_id,
        )
        self.session.add(org)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="organization.created",
            entity_type="Organization",
            entity_id=org.id,
            new_state={"name": org.name, "type": org.type, "status": org.status},
            organization_id=org.id,
        )
        return org

    async def update_settings(
        self,
        ctx: AuthContext,
        *,
        org_id: UUID,
        name: str | None = None,
        share_bps: int | None = ...,  # type: ignore[assignment]
    ) -> Organization:
        org = await self.get_organization(org_id)
        await self.authz.authorize(
            ctx.user_id,
            "org.admin",
            resource_type="organization",
            resource_id=org_id,
        )
        previous = {"name": org.name, "share_bps": org.share_bps}
        if name is not None:
            org.name = name.strip()
        if share_bps is not ...:
            self._assert_share_bps(share_bps)
            org.share_bps = share_bps
        org.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="organization.settings_updated",
            entity_type="Organization",
            entity_id=org.id,
            previous_state=previous,
            new_state={"name": org.name, "share_bps": org.share_bps},
            organization_id=org.id,
        )
        return org

    async def transition(
        self,
        ctx: AuthContext,
        *,
        org_id: UUID,
        action: str,
    ) -> Organization:
        org = await self.get_organization(org_id)
        await self.authz.authorize(
            ctx.user_id,
            "org.admin",
            resource_type="organization",
            resource_id=org_id,
        )
        target = target_for_action(action)
        transition_action(org.status, target)
        previous = {"status": org.status}
        org.status = target
        org.updated_by = ctx.user_id
        await self.session.flush()
        event_type = EVENT_FOR_ORG_STATUS[target]
        event = DomainEvent(
            event_type=event_type,
            producer="identity",
            aggregate_type="Organization",
            aggregate_id=org.id,
            payload={"name": org.name, "type": org.type, "status": org.status, "action": action},
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=org.id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action=f"organization.{action}",
            entity_type="Organization",
            entity_id=org.id,
            previous_state=previous,
            new_state={"status": org.status},
            organization_id=org.id,
        )
        return org

    async def switch_workspace(
        self,
        ctx: AuthContext,
        *,
        org_id: UUID,
    ) -> tuple[Organization, str]:
        org = await self.get_organization(org_id)
        if not await self.can_use_workspace(ctx.user_id, org_id):
            raise ForbiddenError("Not permitted to use this organization workspace")
        if ctx.session_id is None:
            raise AppError("VALIDATION_ERROR", "Session required", 400)
        session_row = await self.session.get(Session, ctx.session_id)
        if session_row is None or session_row.status != "ACTIVE":
            raise ForbiddenError("Session is not active")
        previous = {"organization_id": str(session_row.active_organization_id) if session_row.active_organization_id else None}
        session_row.active_organization_id = org.id
        await self.session.flush()
        access, _expires = create_access_token(
            user_id=ctx.user_id,
            settings=self.settings,
            organization_id=org.id,
            session_id=session_row.id,
            now=self.clock.now(),
        )
        await self.audit.record_from_auth(
            ctx,
            action="organization.workspace_switched",
            entity_type="Organization",
            entity_id=org.id,
            previous_state=previous,
            new_state={"organization_id": str(org.id)},
            organization_id=org.id,
        )
        return org, access

    async def list_memberships(
        self,
        user_id: UUID,
        org_id: UUID,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[OrganizationMembership], str | None]:
        await self.get_organization(org_id)
        if not await self.can_see_org(user_id, org_id):
            raise ForbiddenError("Not permitted")
        page = clamp_limit(limit, default=self.settings.pagination_default_limit)
        stmt = (
            select(OrganizationMembership)
            .where(
                OrganizationMembership.organization_id == org_id,
                OrganizationMembership.deleted_at.is_(None),
            )
            .order_by(OrganizationMembership.created_at.desc(), OrganizationMembership.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(OrganizationMembership.created_at < data["t"])
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor

    async def add_membership(
        self,
        ctx: AuthContext,
        *,
        organization_id: UUID,
        user_id: UUID,
        role_id: UUID | None = None,
        status: str = "ACTIVE",
    ) -> OrganizationMembership:
        org = await self.get_organization(organization_id)
        await self.authz.authorize(
            ctx.user_id,
            "org.admin",
            resource_type="organization",
            resource_id=organization_id,
        )
        if org.status != "ACTIVE":
            raise AppError(
                "ORG_NOT_ACTIVE",
                "Organization is not active",
                409,
                "Suspended or archived organizations cannot add memberships",
            )
        if status not in {"INVITED", "ACTIVE"}:
            raise AppError("VALIDATION_ERROR", "Invalid membership status", 422)
        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None:
            raise NotFoundError("User not found")
        membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=user_id,
            role_id=role_id,
            status=status,
            created_by=ctx.user_id,
        )
        self.session.add(membership)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Active membership already exists") from exc
        if role_id is not None and status == "ACTIVE":
            await self.authz.assign_role(
                user_id=user_id,
                role_id=role_id,
                organization_id=organization_id,
                ctx=ctx,
            )
        await self._emit_membership_changed(
            ctx,
            membership,
            action="membership.created",
            previous=None,
        )
        return membership

    async def update_membership(
        self,
        ctx: AuthContext,
        *,
        organization_id: UUID,
        membership_id: UUID,
        status: str,
        role_id: UUID | None = ...,  # type: ignore[assignment]
    ) -> OrganizationMembership:
        await self.get_organization(organization_id)
        await self.authz.authorize(
            ctx.user_id,
            "org.admin",
            resource_type="organization",
            resource_id=organization_id,
        )
        membership = await self.session.get(OrganizationMembership, membership_id)
        if (
            membership is None
            or membership.deleted_at is not None
            or membership.organization_id != organization_id
        ):
            raise NotFoundError("Membership not found")
        membership_transition_action(membership.status, status)
        if status == "REVOKED":
            await self._assert_not_last_org_admin(organization_id, membership)
        previous = {"status": membership.status, "role_id": str(membership.role_id) if membership.role_id else None}
        membership.status = status
        membership.updated_by = ctx.user_id
        if status == "REVOKED":
            membership.ended_at = self.clock.now()
            await self.authz.revoke_org_assignments(
                user_id=membership.user_id,
                organization_id=organization_id,
                ctx=ctx,
            )
        elif status == "ACTIVE" and membership.role_id is not None:
            await self.authz.assign_role(
                user_id=membership.user_id,
                role_id=membership.role_id,
                organization_id=organization_id,
                ctx=ctx,
            )
        if role_id is not ...:
            membership.role_id = role_id
            if status == "ACTIVE" and role_id is not None:
                await self.authz.assign_role(
                    user_id=membership.user_id,
                    role_id=role_id,
                    organization_id=organization_id,
                    ctx=ctx,
                )
        await self.session.flush()
        await self._emit_membership_changed(
            ctx,
            membership,
            action="membership.updated",
            previous=previous,
        )
        return membership

    async def issue_invitation(
        self,
        ctx: AuthContext,
        *,
        organization_id: UUID,
        email: str,
        role_id: UUID | None = None,
    ) -> tuple[OrganizationInvitation, str]:
        org = await self.get_organization(organization_id)
        await self.authz.authorize(
            ctx.user_id,
            "org.admin",
            resource_type="organization",
            resource_id=organization_id,
        )
        if org.status != "ACTIVE":
            raise AppError(
                "ORG_NOT_ACTIVE",
                "Organization is not active",
                409,
                "Suspended or archived organizations cannot issue invitations",
            )
        email_n = _normalize_email(email)
        invited_user = await self._get_user_by_email(email_n)
        raw = new_opaque_token()
        expires_at = None
        ttl = self.settings.organization_invitation_ttl_seconds
        if ttl > 0:
            expires_at = self.clock.now() + timedelta(seconds=ttl)
        invitation = OrganizationInvitation(
            organization_id=organization_id,
            email=email_n,
            invited_user_id=invited_user.id if invited_user else None,
            role_id=role_id,
            token_hash=hash_secret(raw),
            status="ISSUED",
            expires_at=expires_at,
            created_by=ctx.user_id,
        )
        self.session.add(invitation)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("An outstanding invitation already exists for this email") from exc
        event = DomainEvent(
            event_type=ORGANIZATION_INVITATION_ISSUED,
            producer="identity",
            aggregate_type="OrganizationInvitation",
            aggregate_id=invitation.id,
            payload={
                "organization_id": str(organization_id),
                "email": email_n,
                "invited_user_id": str(invited_user.id) if invited_user else None,
            },
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action="organization.invitation_issued",
            entity_type="OrganizationInvitation",
            entity_id=invitation.id,
            new_state={"email": email_n, "status": "ISSUED", "organization_id": str(organization_id)},
            organization_id=organization_id,
        )
        return invitation, raw

    async def list_invitations(
        self,
        user_id: UUID,
        org_id: UUID,
        *,
        cursor: str | None = None,
        limit: int | None = None,
    ) -> tuple[list[OrganizationInvitation], str | None]:
        await self.get_organization(org_id)
        await self.authz.authorize(
            user_id,
            "org.admin",
            resource_type="organization",
            resource_id=org_id,
        )
        page = clamp_limit(limit, default=self.settings.pagination_default_limit)
        stmt = (
            select(OrganizationInvitation)
            .where(
                OrganizationInvitation.organization_id == org_id,
                OrganizationInvitation.deleted_at.is_(None),
            )
            .order_by(OrganizationInvitation.created_at.desc(), OrganizationInvitation.id.desc())
        )
        if cursor:
            data = decode_cursor(cursor)
            stmt = stmt.where(OrganizationInvitation.created_at < data["t"])
        stmt = stmt.limit(page + 1)
        rows = list((await self.session.execute(stmt)).scalars().all())
        next_cursor = None
        if len(rows) > page:
            last = rows[page - 1]
            next_cursor = encode_cursor(last.created_at.isoformat(), last.id)
            rows = rows[:page]
        return rows, next_cursor

    async def revoke_invitation(
        self,
        ctx: AuthContext,
        *,
        organization_id: UUID,
        invitation_id: UUID,
    ) -> OrganizationInvitation:
        await self.get_organization(organization_id)
        await self.authz.authorize(
            ctx.user_id,
            "org.admin",
            resource_type="organization",
            resource_id=organization_id,
        )
        invitation = await self.session.get(OrganizationInvitation, invitation_id)
        if (
            invitation is None
            or invitation.deleted_at is not None
            or invitation.organization_id != organization_id
        ):
            raise NotFoundError("Invitation not found")
        if invitation.status != "ISSUED":
            raise AppError("INVALID_TRANSITION", "Invitation is not outstanding", 409)
        previous = {"status": invitation.status}
        invitation.status = "REVOKED"
        invitation.revoked_at = self.clock.now()
        invitation.updated_by = ctx.user_id
        await self.session.flush()
        event = DomainEvent(
            event_type=ORGANIZATION_INVITATION_REVOKED,
            producer="identity",
            aggregate_type="OrganizationInvitation",
            aggregate_id=invitation.id,
            payload={"organization_id": str(organization_id)},
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action="organization.invitation_revoked",
            entity_type="OrganizationInvitation",
            entity_id=invitation.id,
            previous_state=previous,
            new_state={"status": "REVOKED"},
            organization_id=organization_id,
        )
        return invitation

    async def accept_invitation(self, ctx: AuthContext, *, token: str) -> OrganizationMembership:
        token_hash = hash_secret(token)
        stmt = (
            select(OrganizationInvitation)
            .where(OrganizationInvitation.token_hash == token_hash)
            .with_for_update()
        )
        invitation = (await self.session.execute(stmt)).scalar_one_or_none()
        if invitation is None or invitation.deleted_at is not None:
            raise NotFoundError("Invitation not found")
        now = self.clock.now()
        if invitation.status == "ISSUED" and invitation.expires_at is not None and invitation.expires_at <= now:
            invitation.status = "EXPIRED"
            await self.session.flush()
            raise AppError("INVITATION_EXPIRED", "Invitation is not available", 409)
        if invitation.status != "ISSUED":
            raise AppError("INVITATION_CONSUMED", "Invitation is not available", 409)
        user = await self.session.get(User, ctx.user_id)
        if user is None or user.deleted_at is not None:
            raise NotFoundError("User not found")
        email_n = _normalize_email(user.email or "")
        if not email_n or email_n != invitation.email:
            raise ForbiddenError("Invitation is not for this user")
        if invitation.invited_user_id is not None and invitation.invited_user_id != ctx.user_id:
            raise ForbiddenError("Invitation is not for this user")
        org = await self.get_organization(invitation.organization_id)
        if org.status != "ACTIVE":
            raise AppError("ORG_NOT_ACTIVE", "Organization is not active", 409)

        existing = await self._open_membership(ctx.user_id, invitation.organization_id)
        if existing and existing.status == "ACTIVE":
            raise ConflictError("Active membership already exists")
        if existing and existing.status == "INVITED":
            membership = existing
            membership.status = "ACTIVE"
            membership.role_id = invitation.role_id or membership.role_id
            membership.updated_by = ctx.user_id
        else:
            membership = OrganizationMembership(
                organization_id=invitation.organization_id,
                user_id=ctx.user_id,
                role_id=invitation.role_id,
                status="ACTIVE",
                created_by=ctx.user_id,
            )
            self.session.add(membership)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Active membership already exists") from exc
        if membership.role_id is not None:
            await self.authz.assign_role(
                user_id=ctx.user_id,
                role_id=membership.role_id,
                organization_id=invitation.organization_id,
                ctx=ctx,
            )
        invitation.status = "ACCEPTED"
        invitation.accepted_at = now
        invitation.accepted_by_user_id = ctx.user_id
        invitation.membership_id = membership.id
        invitation.updated_by = ctx.user_id
        await self.session.flush()
        accept_event = DomainEvent(
            event_type=ORGANIZATION_INVITATION_ACCEPTED,
            producer="identity",
            aggregate_type="OrganizationInvitation",
            aggregate_id=invitation.id,
            payload={
                "organization_id": str(invitation.organization_id),
                "user_id": str(ctx.user_id),
                "membership_id": str(membership.id),
            },
            occurred_at=now,
            actor_id=ctx.user_id,
            organization_id=invitation.organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, accept_event)
        await self._emit_membership_changed(
            ctx,
            membership,
            action="membership.created",
            previous=None,
        )
        await self.audit.record_from_auth(
            ctx,
            action="organization.invitation_accepted",
            entity_type="OrganizationInvitation",
            entity_id=invitation.id,
            new_state={"status": "ACCEPTED", "membership_id": str(membership.id)},
            organization_id=invitation.organization_id,
        )
        return membership

    async def _emit_membership_changed(
        self,
        ctx: AuthContext,
        membership: OrganizationMembership,
        *,
        action: str,
        previous: dict | None,
    ) -> None:
        event = DomainEvent(
            event_type=MEMBERSHIP_CHANGED,
            producer="identity",
            aggregate_type="OrganizationMembership",
            aggregate_id=membership.id,
            payload={
                "organization_id": str(membership.organization_id),
                "user_id": str(membership.user_id),
                "status": membership.status,
            },
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=membership.organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action=action,
            entity_type="OrganizationMembership",
            entity_id=membership.id,
            previous_state=previous,
            new_state=event.payload,
            organization_id=membership.organization_id,
        )

    async def _active_membership(self, user_id: UUID, org_id: UUID) -> OrganizationMembership | None:
        stmt = select(OrganizationMembership).where(
            OrganizationMembership.organization_id == org_id,
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.status == "ACTIVE",
            OrganizationMembership.deleted_at.is_(None),
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def _open_membership(self, user_id: UUID, org_id: UUID) -> OrganizationMembership | None:
        stmt = select(OrganizationMembership).where(
            OrganizationMembership.organization_id == org_id,
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.status.in_(("INVITED", "ACTIVE")),
            OrganizationMembership.deleted_at.is_(None),
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def _get_user_by_email(self, email: str) -> User | None:
        stmt = select(User).where(User.email == email, User.deleted_at.is_(None))
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def _assert_not_last_org_admin(
        self,
        organization_id: UUID,
        membership: OrganizationMembership,
    ) -> None:
        if not await self._membership_provides_org_admin(membership):
            return
        count_stmt = (
            select(func.count())
            .select_from(RoleAssignment)
            .join(Role, Role.id == RoleAssignment.role_id)
            .join(RolePermission, RolePermission.role_id == Role.id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(
                RoleAssignment.organization_id == organization_id,
                RoleAssignment.status == "ACTIVE",
                RoleAssignment.deleted_at.is_(None),
                Role.status == "ACTIVE",
                Role.deleted_at.is_(None),
                Permission.key == "org.admin",
                RoleAssignment.user_id != membership.user_id,
            )
        )
        remaining = int((await self.session.execute(count_stmt)).scalar_one())
        if remaining < 1:
            raise AppError(
                "LAST_ORG_ADMIN",
                "Cannot remove the last organization admin",
                409,
                "Revoking this membership would leave the organization without an org.admin",
            )

    async def _membership_provides_org_admin(self, membership: OrganizationMembership) -> bool:
        stmt = (
            select(RoleAssignment.id)
            .join(Role, Role.id == RoleAssignment.role_id)
            .join(RolePermission, RolePermission.role_id == Role.id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(
                RoleAssignment.user_id == membership.user_id,
                RoleAssignment.organization_id == membership.organization_id,
                RoleAssignment.status == "ACTIVE",
                RoleAssignment.deleted_at.is_(None),
                Permission.key == "org.admin",
            )
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none() is not None

    @staticmethod
    def _assert_share_bps(share_bps: int | None) -> None:
        if share_bps is None:
            return
        if share_bps < 0 or share_bps > 10000:
            raise AppError("VALIDATION_ERROR", "Invalid share_bps", 422, "share_bps must be 0–10000")
