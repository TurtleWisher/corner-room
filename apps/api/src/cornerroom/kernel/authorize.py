"""Pure authorization decision. Deny by default. No wildcard *."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True, slots=True)
class RolePermissionView:
    permission_key: str
    organization_id: UUID | None
    expires_at: datetime | None
    assignment_status: str


@dataclass(frozen=True, slots=True)
class ResourceGrantView:
    permission_key: str
    principal_type: str
    principal_id: UUID
    resource_type: str
    resource_id: UUID
    status: str
    expires_at: datetime | None


@dataclass(frozen=True, slots=True)
class MembershipView:
    organization_id: UUID
    user_id: UUID
    status: str


def _active(status: str, expires_at: datetime | None, now: datetime) -> bool:
    if status != "ACTIVE":
        return False
    if expires_at is not None and expires_at <= now:
        return False
    return True


def collect_permission_keys(
    assignments: list[RolePermissionView],
    now: datetime,
    organization_id: UUID | None = None,
) -> frozenset[str]:
    keys: set[str] = set()
    for row in assignments:
        if not _active(row.assignment_status, row.expires_at, now):
            continue
        if organization_id is None:
            if row.organization_id is not None:
                continue
        elif row.organization_id is not None and row.organization_id != organization_id:
            continue
        keys.add(row.permission_key)
    return frozenset(keys)


def decide_authorize(
    *,
    permission: str,
    now: datetime,
    assignments: list[RolePermissionView],
    grants: list[ResourceGrantView],
    memberships: list[MembershipView],
    user_id: UUID,
    resource_type: str | None = None,
    resource_id: UUID | None = None,
    owner_user_id: UUID | None = None,
    scope_organization_id: UUID | None = None,
) -> bool:
    """Return True only if both capability and resource scope pass."""
    unscoped = collect_permission_keys(assignments, now, organization_id=None)
    has_capability = permission in unscoped

    if resource_type is None or resource_id is None:
        return has_capability

    for grant in grants:
        if grant.permission_key != permission:
            continue
        if grant.resource_type != resource_type or grant.resource_id != resource_id:
            continue
        if grant.principal_type == "user" and grant.principal_id != user_id:
            continue
        if not _active(grant.status, grant.expires_at, now):
            continue
        return True

    is_owner = owner_user_id is not None and owner_user_id == user_id
    if is_owner and has_capability:
        return True

    if resource_type == "organization":
        scoped = collect_permission_keys(assignments, now, organization_id=resource_id)
        if permission in scoped:
            return True
        member = any(
            m.organization_id == resource_id and m.user_id == user_id and m.status == "ACTIVE"
            for m in memberships
        )
        if member and has_capability:
            return True

    if resource_type in {
        "event",
        "venue",
        "product",
        "offer",
        "subscription_plan",
        "rights",
        "royalty_rule",
        "revenue_pool",
        "royalty",
        "royalty_statement",
        "settlement",
        "invoice",
        "payout",
        "journal",
    }:
        if scope_organization_id is None:
            return False
        scoped = collect_permission_keys(assignments, now, organization_id=scope_organization_id)
        if permission in scoped:
            return True
        member = any(
            m.organization_id == scope_organization_id
            and m.user_id == user_id
            and m.status == "ACTIVE"
            for m in memberships
        )
        if member and permission in {"event.read", "venue.read"}:
            return True

    if resource_type in {"artist", "band"}:
        if owner_user_id is not None and owner_user_id == user_id and permission == "artist.manage":
            return True
        if (
            resource_type == "artist"
            and owner_user_id is not None
            and owner_user_id == user_id
            and permission == "analytics.read"
        ):
            return True
        if scope_organization_id is None:
            return False
        scoped = collect_permission_keys(assignments, now, organization_id=scope_organization_id)
        if permission in scoped:
            return True
        return False

    if resource_type in {"track", "release"}:
        if owner_user_id is not None and owner_user_id == user_id and permission == "music.write":
            return True
        if scope_organization_id is None:
            return False
        scoped = collect_permission_keys(assignments, now, organization_id=scope_organization_id)
        if permission in scoped:
            return True
        return False

    return False
