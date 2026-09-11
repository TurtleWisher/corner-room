"""Role, assignment, and resource-grant admin routes."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from cornerroom.api.deps import authz_service, get_auth_context, require_permission
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.authorization.application.service import AuthorizationService

router = APIRouter(tags=["permissions"])


class RoleOut(BaseModel):
    id: UUID
    key: str
    name: str
    status: str


class RoleCreate(BaseModel):
    key: str = Field(min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    name: str = Field(min_length=1, max_length=120)


class RolePermissionIn(BaseModel):
    permission_key: str


class AssignmentCreate(BaseModel):
    role_id: UUID
    organization_id: UUID | None = None


class AssignmentOut(BaseModel):
    id: UUID
    user_id: UUID
    role_id: UUID
    organization_id: UUID | None
    status: str


class GrantCreate(BaseModel):
    principal_type: str = Field(pattern="^(user|role|org_membership)$")
    principal_id: UUID
    permission_key: str
    resource_type: str
    resource_id: UUID
    expires_at: datetime | None = None


class PermissionOut(BaseModel):
    id: UUID
    key: str
    description: str | None


class GrantOut(BaseModel):
    id: UUID
    principal_type: str
    principal_id: UUID
    permission_key: str
    resource_type: str
    resource_id: UUID
    status: str


@router.get("/roles", response_model=list[RoleOut], dependencies=[Depends(require_permission("role.admin"))])
async def list_roles(
    authz: Annotated[AuthorizationService, Depends(authz_service)],
) -> list[RoleOut]:
    roles = await authz.list_roles()
    return [RoleOut(id=r.id, key=r.key, name=r.name, status=r.status) for r in roles]


@router.post(
    "/roles",
    response_model=RoleOut,
    status_code=201,
    dependencies=[Depends(require_permission("role.admin"))],
)
async def create_role(
    body: RoleCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    authz: Annotated[AuthorizationService, Depends(authz_service)],
) -> RoleOut:
    role = await authz.create_role(key=body.key, name=body.name, ctx=ctx)
    return RoleOut(id=role.id, key=role.key, name=role.name, status=role.status)


@router.post(
    "/roles/{role_id}/permissions",
    status_code=204,
    dependencies=[Depends(require_permission("role.admin"))],
)
async def attach_permission(
    role_id: UUID,
    body: RolePermissionIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    authz: Annotated[AuthorizationService, Depends(authz_service)],
) -> None:
    await authz.attach_permission(role_id=role_id, permission_key=body.permission_key, ctx=ctx)


@router.post(
    "/users/{user_id}/assignments",
    response_model=AssignmentOut,
    status_code=201,
    dependencies=[Depends(require_permission("role.admin"))],
)
async def assign_role(
    user_id: UUID,
    body: AssignmentCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    authz: Annotated[AuthorizationService, Depends(authz_service)],
) -> AssignmentOut:
    assignment = await authz.assign_role(
        user_id=user_id,
        role_id=body.role_id,
        organization_id=body.organization_id,
        ctx=ctx,
    )
    return AssignmentOut(
        id=assignment.id,
        user_id=assignment.user_id,
        role_id=assignment.role_id,
        organization_id=assignment.organization_id,
        status=assignment.status,
    )


@router.post(
    "/resource-grants",
    response_model=GrantOut,
    status_code=201,
    dependencies=[Depends(require_permission("role.admin"))],
)
async def create_grant(
    body: GrantCreate,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    authz: Annotated[AuthorizationService, Depends(authz_service)],
) -> GrantOut:
    grant = await authz.grant_resource(
        principal_type=body.principal_type,
        principal_id=body.principal_id,
        permission_key=body.permission_key,
        resource_type=body.resource_type,
        resource_id=body.resource_id,
        ctx=ctx,
        expires_at=body.expires_at,
    )
    return GrantOut(
        id=grant.id,
        principal_type=grant.principal_type,
        principal_id=grant.principal_id,
        permission_key=grant.permission_key,
        resource_type=grant.resource_type,
        resource_id=grant.resource_id,
        status=grant.status,
    )


@router.get(
    "/permissions",
    response_model=list[PermissionOut],
    dependencies=[Depends(require_permission("role.admin"))],
)
async def list_permissions(
    authz: Annotated[AuthorizationService, Depends(authz_service)],
) -> list[PermissionOut]:
    rows = await authz.list_permissions()
    return [PermissionOut(id=row.id, key=row.key, description=row.description) for row in rows]


@router.delete(
    "/assignments/{assignment_id}",
    status_code=204,
    dependencies=[Depends(require_permission("role.admin"))],
)
async def revoke_assignment(
    assignment_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    authz: Annotated[AuthorizationService, Depends(authz_service)],
) -> None:
    await authz.revoke_assignment(assignment_id, ctx)


@router.delete(
    "/resource-grants/{grant_id}",
    status_code=204,
    dependencies=[Depends(require_permission("role.admin"))],
)
async def revoke_grant(
    grant_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    authz: Annotated[AuthorizationService, Depends(authz_service)],
) -> None:
    await authz.revoke_grant(grant_id, ctx)
