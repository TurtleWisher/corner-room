"""Foundation seed: permissions, roles, PLATFORM + LABEL orgs. Idempotent."""

from __future__ import annotations

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.security import hash_password
from cornerroom.infra.settings import Settings
from cornerroom.modules.authorization.domain.models import (
    FOUNDATION_PERMISSIONS,
    Permission,
    Role,
    RoleAssignment,
    RolePermission,
)
from cornerroom.modules.identity.domain.models import Organization, User
from cornerroom.modules.notifications.domain.models import NotificationTemplate

log = structlog.get_logger("seed")

ROLE_PERMISSIONS: dict[str, tuple[str, tuple[str, ...]]] = {
    "customer": ("Customer", ()),
    "artist": ("Artist", ()),
    "artist_manager": ("Artist Manager", ()),
    "band_member": ("Band Member", ()),
    "event_manager": (
        "Event Manager",
        ("event.read", "event.write", "event.publish", "event.cancel", "venue.read"),
    ),
    "marketing_manager": ("Marketing Manager", ("campaign.write", "event.read")),
    "finance_manager": (
        "Finance Manager",
        (
            "finance.read",
            "finance.post",
            "finance.payout_approve",
            "commerce.write",
            "commerce.grant",
            "royalty.read",
            "royalty.run",
        ),
    ),
    "content_manager": (
        "Content Manager",
        ("music.write", "music.approve", "music.takedown"),
    ),
    "label_manager": ("Label Manager", ("artist.manage", "music.write")),
    "ops_manager": (
        "Operations Manager",
        ("event.read", "event.write", "event.publish", "event.cancel", "venue.read", "venue.write"),
    ),
    "checkin_staff": ("Check-in Staff", ("event.read", "ticket.checkin")),
    "support": ("Support", ()),
    "analyst": ("Analyst", ("analytics.read",)),
    "legal": ("Legal", ("music.takedown",)),
    "admin": ("Administrator", ("user.admin", "org.admin", "audit.read")),
    "super_admin": ("Super Admin", FOUNDATION_PERMISSIONS),
    "venue_partner": ("Venue Partner", ("venue.read", "venue.write")),
    "sponsor": ("Sponsor", ()),
    "producer": ("Producer", ()),
    "songwriter": ("Songwriter", ()),
}

SEED_ORGS = (
    ("PLATFORM", "Corner Room Platform"),
    ("LABEL", "Corner Room Label"),
)


async def seed_foundation(session: AsyncSession, settings: Settings) -> None:
    perms: dict[str, Permission] = {}
    for key in FOUNDATION_PERMISSIONS:
        row = (
            await session.execute(select(Permission).where(Permission.key == key))
        ).scalar_one_or_none()
        if row is None:
            row = Permission(key=key, description=key)
            session.add(row)
            await session.flush()
        perms[key] = row

    roles: dict[str, Role] = {}
    for key, (name, perm_keys) in ROLE_PERMISSIONS.items():
        role = (await session.execute(select(Role).where(Role.key == key))).scalar_one_or_none()
        if role is None:
            role = Role(key=key, name=name, status="ACTIVE")
            session.add(role)
            await session.flush()
        roles[key] = role
        for perm_key in perm_keys:
            existing = await session.get(RolePermission, (role.id, perms[perm_key].id))
            if existing is None:
                session.add(RolePermission(role_id=role.id, permission_id=perms[perm_key].id))

    for org_type, name in SEED_ORGS:
        found = (
            await session.execute(
                select(Organization).where(
                    Organization.type == org_type,
                    Organization.name == name,
                    Organization.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if found is None:
            session.add(Organization(type=org_type, name=name, status="ACTIVE"))

    welcome = (
        await session.execute(
            select(NotificationTemplate).where(
                NotificationTemplate.type == "user.registered",
                NotificationTemplate.locale == "en",
            )
        )
    ).scalar_one_or_none()
    if welcome is None:
        session.add(
            NotificationTemplate(
                type="user.registered",
                locale="en",
                version=1,
                body="Welcome to Corner Room. Your account was created and may require verification before sign-in.",
            )
        )

    invite_tpl = (
        await session.execute(
            select(NotificationTemplate).where(
                NotificationTemplate.type == "organization.invitation_issued",
                NotificationTemplate.locale == "en",
            )
        )
    ).scalar_one_or_none()
    if invite_tpl is None:
        session.add(
            NotificationTemplate(
                type="organization.invitation_issued",
                locale="en",
                version=1,
                body="You were invited to a Corner Room organization. Delivery of this message is event-driven; no email provider is configured in this phase.",
            )
        )

    for ntype, body in (
        ("entitlement.granted", "A commercial entitlement is now active on your account."),
        ("subscription.started", "Your subscription is active for the current period."),
        ("subscription.cancelled", "Your subscription is cancelled. Access continues until the current period ends."),
        ("royalty.statement_issued", "A royalty statement is available."),
        ("royalty.statement_adjusted", "A royalty statement was adjusted."),
        ("campaign.task_assigned", "A campaign task was assigned to you."),
        ("campaign.task_completed", "A campaign task was completed."),
    ):
        found = (
            await session.execute(
                select(NotificationTemplate).where(
                    NotificationTemplate.type == ntype,
                    NotificationTemplate.locale == "en",
                )
            )
        ).scalar_one_or_none()
        if found is None:
            session.add(
                NotificationTemplate(type=ntype, locale="en", version=1, body=body)
            )

    if settings.bootstrap_admin_email and settings.bootstrap_admin_password:
        email = settings.bootstrap_admin_email.strip().lower()
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            user = User(
                email=email,
                password_hash=hash_password(settings.bootstrap_admin_password),
                status="ACTIVE",
            )
            session.add(user)
            await session.flush()
            session.add(
                RoleAssignment(
                    user_id=user.id,
                    role_id=roles["super_admin"].id,
                    organization_id=None,
                    status="ACTIVE",
                )
            )
            log.info("bootstrap_admin_created", email=email)

    await session.flush()
    log.info("foundation_seeded")
