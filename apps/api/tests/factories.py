"""Test factories for User / Organization."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.security import hash_password
from cornerroom.modules.authorization.domain.models import Role, RoleAssignment
from cornerroom.modules.identity.domain.models import CustomerProfile, Organization, User


async def create_user(
    session: AsyncSession,
    *,
    email: str,
    password: str = "password12",
    status: str = "ACTIVE",
    display_name: str | None = None,
) -> User:
    user = User(email=email.lower(), password_hash=hash_password(password), status=status)
    session.add(user)
    await session.flush()
    session.add(
        CustomerProfile(
            user_id=user.id,
            display_name=display_name or email.split("@")[0],
            status="ACTIVE",
            locale="en",
        )
    )
    await session.flush()
    return user


async def assign_role(session: AsyncSession, user_id: UUID, role_key: str) -> RoleAssignment:
    from sqlalchemy import select

    role = (await session.execute(select(Role).where(Role.key == role_key))).scalar_one()
    assignment = RoleAssignment(user_id=user_id, role_id=role.id, status="ACTIVE")
    session.add(assignment)
    await session.flush()
    return assignment


async def create_org(
    session: AsyncSession,
    *,
    name: str = "Test Label",
    org_type: str = "LABEL",
    status: str = "ACTIVE",
) -> Organization:
    org = Organization(name=name, type=org_type, status=status)
    session.add(org)
    await session.flush()
    return org
