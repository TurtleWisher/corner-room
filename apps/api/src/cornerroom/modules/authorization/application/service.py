"""Authorization application service. Deny by default. No wildcard *."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import ConflictError, ForbiddenError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.authorize import (
    MembershipView,
    ResourceGrantView,
    RolePermissionView,
    collect_permission_keys,
    decide_authorize,
)
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    RESOURCE_GRANT_CHANGED,
    ROLE_ASSIGNMENT_CHANGED,
    ROLE_REVOKED,
    DomainEvent,
)
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.domain.models import (
    Permission,
    ResourceGrant,
    Role,
    RoleAssignment,
    RolePermission,
)
from cornerroom.modules.identity.domain.models import OrganizationMembership


class AuthorizationService:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)

    async def load_permission_views(self, user_id: UUID) -> list[RolePermissionView]:
        stmt = (
            select(RoleAssignment, Permission.key)
            .join(Role, Role.id == RoleAssignment.role_id)
            .join(RolePermission, RolePermission.role_id == Role.id)
            .join(Permission, Permission.id == RolePermission.permission_id)
            .where(
                RoleAssignment.user_id == user_id,
                RoleAssignment.deleted_at.is_(None),
                Role.deleted_at.is_(None),
                Role.status == "ACTIVE",
            )
        )
        rows = (await self.session.execute(stmt)).all()
        return [
            RolePermissionView(
                permission_key=key,
                organization_id=assignment.organization_id,
                expires_at=assignment.expires_at,
                assignment_status=assignment.status,
            )
            for assignment, key in rows
        ]

    async def load_grants(self, user_id: UUID) -> list[ResourceGrantView]:
        role_ids = (
            await self.session.execute(
                select(RoleAssignment.role_id).where(
                    RoleAssignment.user_id == user_id,
                    RoleAssignment.status == "ACTIVE",
                    RoleAssignment.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        membership_ids = (
            await self.session.execute(
                select(OrganizationMembership.id).where(
                    OrganizationMembership.user_id == user_id,
                    OrganizationMembership.status == "ACTIVE",
                    OrganizationMembership.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        clauses = [
            and_(ResourceGrant.principal_type == "user", ResourceGrant.principal_id == user_id)
        ]
        if role_ids:
            clauses.append(
                and_(ResourceGrant.principal_type == "role", ResourceGrant.principal_id.in_(role_ids))
            )
        if membership_ids:
            clauses.append(
                and_(
                    ResourceGrant.principal_type == "org_membership",
                    ResourceGrant.principal_id.in_(membership_ids),
                )
            )
        stmt = select(ResourceGrant).where(ResourceGrant.deleted_at.is_(None), or_(*clauses))
        rows = (await self.session.execute(stmt)).scalars().all()
        return [
            ResourceGrantView(
                permission_key=g.permission_key,
                principal_type=g.principal_type,
                principal_id=g.principal_id,
                resource_type=g.resource_type,
                resource_id=g.resource_id,
                status=g.status,
                expires_at=g.expires_at,
            )
            for g in rows
        ]

    async def load_memberships(self, user_id: UUID) -> list[MembershipView]:
        stmt = select(OrganizationMembership).where(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.deleted_at.is_(None),
        )
        rows = (await self.session.execute(stmt)).scalars().all()
        return [
            MembershipView(
                organization_id=m.organization_id,
                user_id=m.user_id,
                status=m.status,
            )
            for m in rows
        ]

    async def authorize(
        self,
        user_id: UUID,
        permission: str,
        *,
        resource_type: str | None = None,
        resource_id: UUID | None = None,
        owner_user_id: UUID | None = None,
        scope_organization_id: UUID | None = None,
    ) -> None:
        allowed = decide_authorize(
            permission=permission,
            now=self.clock.now(),
            assignments=await self.load_permission_views(user_id),
            grants=await self.load_grants(user_id),
            memberships=await self.load_memberships(user_id),
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            owner_user_id=owner_user_id,
            scope_organization_id=scope_organization_id,
        )
        if not allowed:
            raise ForbiddenError(f"Missing permission {permission}")

    async def list_roles(self) -> list[Role]:
        stmt = select(Role).where(Role.deleted_at.is_(None)).order_by(Role.key)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_role_by_key(self, key: str) -> Role | None:
        stmt = select(Role).where(Role.key == key, Role.deleted_at.is_(None))
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def create_role(
        self,
        *,
        key: str,
        name: str,
        ctx: AuthContext,
    ) -> Role:
        existing = await self.get_role_by_key(key)
        if existing:
            raise ConflictError("Role key already exists")
        role = Role(key=key, name=name, status="ACTIVE", created_by=ctx.user_id)
        self.session.add(role)
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="role.created",
            entity_type="Role",
            entity_id=role.id,
            new_state={"key": key, "name": name},
        )
        return role

    async def attach_permission(
        self,
        *,
        role_id: UUID,
        permission_key: str,
        ctx: AuthContext,
    ) -> None:
        role = await self.session.get(Role, role_id)
        if role is None or role.deleted_at is not None:
            raise NotFoundError("Role not found")
        perm_stmt = select(Permission).where(Permission.key == permission_key)
        permission = (await self.session.execute(perm_stmt)).scalar_one_or_none()
        if permission is None:
            raise NotFoundError("Permission not found")
        existing = await self.session.get(RolePermission, (role_id, permission.id))
        if existing:
            return
        self.session.add(RolePermission(role_id=role_id, permission_id=permission.id))
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="role.permission_attached",
            entity_type="Role",
            entity_id=role_id,
            new_state={"permission_key": permission_key},
        )

    async def list_permissions(self) -> list[Permission]:
        stmt = select(Permission).order_by(Permission.key)
        return list((await self.session.execute(stmt)).scalars().all())

    async def assign_role(
        self,
        *,
        user_id: UUID,
        role_id: UUID,
        organization_id: UUID | None,
        ctx: AuthContext,
    ) -> RoleAssignment:
        role = await self.session.get(Role, role_id)
        if role is None or role.deleted_at is not None:
            raise NotFoundError("Role not found")
        existing_stmt = select(RoleAssignment).where(
            RoleAssignment.user_id == user_id,
            RoleAssignment.role_id == role_id,
            RoleAssignment.status == "ACTIVE",
            RoleAssignment.deleted_at.is_(None),
        )
        if organization_id is None:
            existing_stmt = existing_stmt.where(RoleAssignment.organization_id.is_(None))
        else:
            existing_stmt = existing_stmt.where(RoleAssignment.organization_id == organization_id)
        existing = (await self.session.execute(existing_stmt)).scalar_one_or_none()
        if existing:
            return existing
        assignment = RoleAssignment(
            user_id=user_id,
            role_id=role_id,
            organization_id=organization_id,
            status="ACTIVE",
            created_by=ctx.user_id,
        )
        self.session.add(assignment)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("Active assignment already exists") from exc
        event = DomainEvent(
            event_type=ROLE_ASSIGNMENT_CHANGED,
            producer="authorization",
            aggregate_type="RoleAssignment",
            aggregate_id=assignment.id,
            payload={
                "user_id": str(user_id),
                "role_id": str(role_id),
                "organization_id": str(organization_id) if organization_id else None,
                "status": "ACTIVE",
            },
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action="role.assigned",
            entity_type="RoleAssignment",
            entity_id=assignment.id,
            new_state={
                "user_id": str(user_id),
                "role_key": role.key,
                "organization_id": str(organization_id) if organization_id else None,
            },
        )
        return assignment

    async def permission_keys(
        self, user_id: UUID, organization_id: UUID | None = None
    ) -> frozenset[str]:
        views = await self.load_permission_views(user_id)
        return collect_permission_keys(views, self.clock.now(), organization_id=organization_id)

    async def revoke_org_assignments(
        self,
        *,
        user_id: UUID,
        organization_id: UUID,
        ctx: AuthContext,
    ) -> int:
        stmt = select(RoleAssignment).where(
            RoleAssignment.user_id == user_id,
            RoleAssignment.organization_id == organization_id,
            RoleAssignment.status == "ACTIVE",
            RoleAssignment.deleted_at.is_(None),
        )
        rows = list((await self.session.execute(stmt)).scalars().all())
        for assignment in rows:
            await self.revoke_assignment(assignment.id, ctx)
        return len(rows)

    async def revoke_assignment(self, assignment_id: UUID, ctx: AuthContext) -> RoleAssignment:
        assignment = await self.session.get(RoleAssignment, assignment_id)
        if assignment is None or assignment.deleted_at is not None:
            raise NotFoundError("Assignment not found")
        previous = {"status": assignment.status}
        assignment.status = "REVOKED"
        assignment.updated_by = ctx.user_id
        await self.session.flush()
        event = DomainEvent(
            event_type=ROLE_REVOKED,
            producer="authorization",
            aggregate_type="RoleAssignment",
            aggregate_id=assignment.id,
            payload={
                "user_id": str(assignment.user_id),
                "role_id": str(assignment.role_id),
                "status": "REVOKED",
            },
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            organization_id=assignment.organization_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action="role.revoked",
            entity_type="RoleAssignment",
            entity_id=assignment.id,
            previous_state=previous,
            new_state={"status": "REVOKED"},
        )
        return assignment

    async def grant_resource(
        self,
        *,
        principal_type: str,
        principal_id: UUID,
        permission_key: str,
        resource_type: str,
        resource_id: UUID,
        ctx: AuthContext,
        expires_at: datetime | None = None,
    ) -> ResourceGrant:
        existing_stmt = select(ResourceGrant).where(
            ResourceGrant.principal_type == principal_type,
            ResourceGrant.principal_id == principal_id,
            ResourceGrant.permission_key == permission_key,
            ResourceGrant.resource_type == resource_type,
            ResourceGrant.resource_id == resource_id,
            ResourceGrant.status == "ACTIVE",
            ResourceGrant.deleted_at.is_(None),
        )
        existing = (await self.session.execute(existing_stmt)).scalar_one_or_none()
        if existing:
            return existing
        grant = ResourceGrant(
            principal_type=principal_type,
            principal_id=principal_id,
            permission_key=permission_key,
            resource_type=resource_type,
            resource_id=resource_id,
            status="ACTIVE",
            expires_at=expires_at,
            created_by=ctx.user_id,
        )
        self.session.add(grant)
        await self.session.flush()
        event = DomainEvent(
            event_type=RESOURCE_GRANT_CHANGED,
            producer="authorization",
            aggregate_type="ResourceGrant",
            aggregate_id=grant.id,
            payload={
                "principal_type": principal_type,
                "principal_id": str(principal_id),
                "permission_key": permission_key,
                "resource_type": resource_type,
                "resource_id": str(resource_id),
                "status": "ACTIVE",
            },
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action="resource_grant.created",
            entity_type="ResourceGrant",
            entity_id=grant.id,
            new_state=event.payload,
        )
        return grant

    async def revoke_grant(self, grant_id: UUID, ctx: AuthContext) -> ResourceGrant:
        grant = await self.session.get(ResourceGrant, grant_id)
        if grant is None or grant.deleted_at is not None:
            raise NotFoundError("Grant not found")
        previous = {"status": grant.status}
        grant.status = "REVOKED"
        grant.updated_by = ctx.user_id
        await self.session.flush()
        event = DomainEvent(
            event_type=RESOURCE_GRANT_CHANGED,
            producer="authorization",
            aggregate_type="ResourceGrant",
            aggregate_id=grant.id,
            payload={"status": "REVOKED", "grant_id": str(grant.id)},
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action="resource_grant.revoked",
            entity_type="ResourceGrant",
            entity_id=grant.id,
            previous_state=previous,
            new_state={"status": "REVOKED"},
        )
        return grant


def system_context(request_id: str = "system") -> AuthContext:
    from uuid import UUID as _UUID

    return AuthContext(
        user_id=_UUID(int=0),
        request_id=request_id,
        actor_type="system",
    )
