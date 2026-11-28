"""Staff accounts in the staff portal (owner, 2026-11-28, D-STAFF-ACCOUNTS-01).

Admins add staff and admin accounts by email. A staff account is an ordinary Corner Room account
with platform-wide staff roles (levels and areas in `domain/staff_levels.py`), so a fan account
that becomes staff keeps its purchases, library and sign-ins. Continue with Google links the
Google sign-in to the account with the same verified email (Q-GAUTH-01), so a person invited with
their Gmail address signs in with Google and lands in the portal.

- The email already belongs to a verified, active account: the roles are given at once.
- Otherwise the invite waits (`identity.staff_invites`) and is applied when an account with that
  email is verified (Google sign-in makes it verified): by the outbox consumer below, and by
  `claim_for_user` the staff pages call on arrival, so nobody waits for the worker.
  An unverified account never gets staff powers: someone could have signed up with the address.

Every change is audited (`staff_account.*`) and goes through AuthorizationService, which writes
`role.assigned` / `role.revoked` with their events. Permissions are read from the database on
every request, so taking someone off works at once.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import UUID

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    STAFF_ACCOUNT_INVITED,
    USER_ACTIVATED,
    USER_REGISTERED,
    USER_VERIFIED,
    DomainEvent,
)
from cornerroom.modules.administration.domain.staff_levels import (
    ADMIN_ROLE,
    AREA_KEYS,
    AREAS,
    OWNER_ROLE,
    allowed_levels,
    areas_of,
    clean_areas,
    level_for,
    refusal,
)
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.audit.domain.models import AuditLog
from cornerroom.modules.authorization.application.service import AuthorizationService, system_context
from cornerroom.modules.authorization.domain.models import Role, RoleAssignment
from cornerroom.modules.identity.domain.models import (
    CustomerProfile,
    ExternalIdentity,
    Organization,
    OrganizationMembership,
    User,
)
from cornerroom.modules.identity.domain.staff_invites import StaffInvite

log = structlog.get_logger("staff_accounts")

# Roles this page gives and takes. The owner's `super_admin` is never touched from here.
MANAGED_ROLES = frozenset({ADMIN_ROLE}) | AREA_KEYS
STAFF_ROLES = MANAGED_ROLES | {OWNER_ROLE}
# Corner Room's own workspaces: area staff are made members so they can act in them.
HOME_ORG_TYPES = ("PLATFORM", "LABEL")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
NOTE_MAX = 500

MESSAGES = {
    "NOT_ALLOWED": "Only admins can manage staff accounts.",
    "NOT_YOURSELF": "You can't change your own staff account. Ask another admin or the owner.",
    "OWNER_FIXED": "The owner's account can't be changed here.",
    "BAD_LEVEL": "Choose Admin or Staff.",
    "OWNER_ONLY": "Only the owner can add, change or remove admins.",
    "NO_AREAS": "Pick at least one area for a staff account.",
    "BAD_EMAIL": "Type a full email address, like name@gmail.com.",
    "ACCOUNT_NOT_ACTIVE": "That account is suspended or closed. Reactivate it in Users first.",
    "NOT_STAFF": "This person isn't on the staff.",
}


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def _refuse(code: str) -> AppError:
    status = 404 if code == "NOT_STAFF" else 422 if code in {"NO_AREAS", "BAD_EMAIL", "BAD_LEVEL"} else 403
    return AppError(code, MESSAGES.get(code, "That change isn't allowed."), status)


@dataclass(frozen=True, slots=True)
class Applied:
    previous_level: str | None
    level: str | None
    areas: list[str]


class StaffAccountsService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        clock: Clock | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.settings = settings or get_settings()
        self.authz = AuthorizationService(session, clock=self.clock)
        self.audit = AuditService(session)

    # ----- reading -------------------------------------------------------------------------

    async def viewer_permissions(self, user_id: UUID) -> frozenset[str]:
        return await self.authz.permission_keys(user_id, organization_id=None)

    async def platform_roles(self, user_ids: list[UUID] | None = None) -> dict[UUID, set[str]]:
        """Active platform-wide staff role keys per account (only staff roles)."""
        now = self.clock.now()
        stmt = (
            select(RoleAssignment.user_id, Role.key)
            .join(Role, Role.id == RoleAssignment.role_id)
            .where(
                RoleAssignment.organization_id.is_(None),
                RoleAssignment.status == "ACTIVE",
                RoleAssignment.deleted_at.is_(None),
                Role.deleted_at.is_(None),
                Role.key.in_(sorted(STAFF_ROLES)),
                (RoleAssignment.expires_at.is_(None)) | (RoleAssignment.expires_at > now),
            )
        )
        if user_ids is not None:
            if not user_ids:
                return {}
            stmt = stmt.where(RoleAssignment.user_id.in_(user_ids))
        out: dict[UUID, set[str]] = {}
        for uid, key in (await self.session.execute(stmt)).all():
            out.setdefault(uid, set()).add(key)
        return out

    async def staff_user_ids(self) -> list[UUID]:
        return list((await self.platform_roles()).keys())

    async def _names(self, user_ids: list[UUID]) -> dict[UUID, str]:
        if not user_ids:
            return {}
        rows = (
            await self.session.execute(
                select(CustomerProfile.user_id, CustomerProfile.display_name).where(
                    CustomerProfile.user_id.in_(user_ids), CustomerProfile.deleted_at.is_(None)
                )
            )
        ).all()
        return {uid: (name or "").strip() for uid, name in rows if (name or "").strip()}

    async def people(self, user_ids: list[UUID]) -> dict[UUID, dict[str, Any]]:
        """Name, email and picture for staff screens (staff see each other's real details)."""
        from cornerroom.modules.commerce.application.customers import user_pictures

        if not user_ids:
            return {}
        users = (await self.session.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
        names = await self._names(user_ids)
        try:
            pictures = await user_pictures(self.session, user_ids)
        except Exception:  # pictures are decoration; a storage hiccup must not hide the list
            log.warning("staff_pictures_failed")
            pictures = {}
        return {
            u.id: {
                "name": names.get(u.id) or (u.email.split("@")[0] if u.email else "Staff member"),
                "email": u.email,
                "picture_url": pictures.get(u.id),
            }
            for u in users
        }

    async def list_accounts(self, ctx: AuthContext) -> dict[str, Any]:
        perms = await self.viewer_permissions(ctx.user_id)
        if refusal(viewer_id=ctx.user_id, viewer_permissions=perms, target_id=None, current_level=None, new_level="STAFF") == "NOT_ALLOWED":
            raise _refuse("NOT_ALLOWED")
        roles = await self.platform_roles()
        ids = list(roles.keys())
        people = await self.people(ids)
        users = {u.id: u for u in (await self.session.execute(select(User).where(User.id.in_(ids or [UUID(int=0)])))).scalars()}
        google = set(
            (
                await self.session.execute(
                    select(ExternalIdentity.user_id).where(
                        ExternalIdentity.user_id.in_(ids or [UUID(int=0)]),
                        ExternalIdentity.provider == "google",
                        ExternalIdentity.unlinked_at.is_(None),
                    )
                )
            ).scalars()
        )
        since = self.clock.now() - timedelta(days=7)
        activity: dict[str, tuple[Any, int]] = {}
        if ids:
            for actor, last, recent in (
                await self.session.execute(
                    select(
                        AuditLog.actor_id,
                        func.max(AuditLog.occurred_at),
                        func.count().filter(AuditLog.occurred_at >= since),
                    )
                    .where(AuditLog.actor_id.in_([str(i) for i in ids]), AuditLog.actor_type == "user")
                    .group_by(AuditLog.actor_id)
                )
            ).all():
                activity[actor] = (last, int(recent))
        accounts = []
        for uid, keys in roles.items():
            level = level_for(keys)
            if level is None:
                continue
            user = users.get(uid)
            last, recent = activity.get(str(uid), (None, 0))
            accounts.append(
                {
                    "user_id": uid,
                    **people.get(uid, {"name": "Staff member", "email": None, "picture_url": None}),
                    "level": level,
                    "areas": areas_of(keys) if level == "STAFF" else [],
                    "status": user.status if user else "UNKNOWN",
                    "google_linked": uid in google,
                    "last_active_at": last,
                    "actions_7d": recent,
                    "is_you": uid == ctx.user_id,
                    "can_change": refusal(
                        viewer_id=ctx.user_id, viewer_permissions=perms, target_id=uid, current_level=level, new_level="STAFF"
                    )
                    is None,
                }
            )
        order = {"OWNER": 0, "ADMIN": 1, "STAFF": 2}
        accounts.sort(key=lambda a: (order[a["level"]], (a["name"] or "").lower()))
        invites = (
            await self.session.execute(
                select(StaffInvite).where(StaffInvite.status == "WAITING").order_by(StaffInvite.created_at.desc())
            )
        ).scalars().all()
        inviters = await self.people([i.created_by for i in invites if i.created_by])
        return {
            "accounts": accounts,
            "invites": [
                {
                    "id": i.id,
                    "email": i.email,
                    "level": i.level,
                    "areas": clean_areas(list(i.areas or [])) if i.level == "STAFF" else [],
                    "note": i.note,
                    "invited_at": i.created_at,
                    "invited_by": (inviters.get(i.created_by) or {}).get("name") if i.created_by else None,
                    "can_cancel": refusal(
                        viewer_id=ctx.user_id, viewer_permissions=perms, target_id=None, current_level=i.level, new_level=None
                    )
                    is None,
                }
                for i in invites
            ],
            "areas": [{"key": a.role_key, "label": a.label, "does": a.does, "group": a.group} for a in AREAS],
            "can_add_levels": allowed_levels(perms),
        }

    # ----- changing ------------------------------------------------------------------------

    async def _roles_by_key(self, keys: set[str]) -> dict[str, Role]:
        rows = (await self.session.execute(select(Role).where(Role.key.in_(sorted(keys)), Role.deleted_at.is_(None)))).scalars()
        return {r.key: r for r in rows}

    async def _home_orgs(self) -> list[Organization]:
        return list(
            (
                await self.session.execute(
                    select(Organization).where(
                        Organization.type.in_(HOME_ORG_TYPES),
                        Organization.status == "ACTIVE",
                        Organization.deleted_at.is_(None),
                    )
                )
            ).scalars()
        )

    async def _set_memberships(self, user_id: UUID, *, member: bool, actor: UUID | None) -> None:
        now = self.clock.now()
        for org in await self._home_orgs():
            rows = list(
                (
                    await self.session.execute(
                        select(OrganizationMembership).where(
                            OrganizationMembership.organization_id == org.id,
                            OrganizationMembership.user_id == user_id,
                            OrganizationMembership.status.in_(("INVITED", "ACTIVE")),
                            OrganizationMembership.deleted_at.is_(None),
                        )
                    )
                ).scalars()
            )
            if member:
                if rows:
                    for row in rows:
                        if row.status != "ACTIVE":
                            row.status = "ACTIVE"
                            row.updated_by = actor
                else:
                    self.session.add(
                        OrganizationMembership(
                            organization_id=org.id, user_id=user_id, status="ACTIVE", created_by=actor, updated_by=actor
                        )
                    )
            else:
                for row in rows:
                    row.status = "REVOKED"
                    row.ended_at = now
                    row.updated_by = actor
        await self.session.flush()

    async def _apply(self, ctx: AuthContext, user_id: UUID, level: str | None, areas: list[str]) -> Applied:
        """Make this account's platform-wide staff roles match the level (None: not staff)."""
        held = (await self.platform_roles([user_id])).get(user_id, set())
        previous = level_for(held)
        if previous == "OWNER":
            raise _refuse("OWNER_FIXED")
        want = {ADMIN_ROLE} if level == "ADMIN" else set(clean_areas(areas)) if level == "STAFF" else set()
        roles = await self._roles_by_key(set(MANAGED_ROLES))
        assignments = (
            await self.session.execute(
                select(RoleAssignment, Role.key)
                .join(Role, Role.id == RoleAssignment.role_id)
                .where(
                    RoleAssignment.user_id == user_id,
                    RoleAssignment.organization_id.is_(None),
                    RoleAssignment.status == "ACTIVE",
                    RoleAssignment.deleted_at.is_(None),
                    Role.key.in_(sorted(MANAGED_ROLES)),
                )
            )
        ).all()
        for assignment, key in assignments:
            if key not in want:
                await self.authz.revoke_assignment(assignment.id, ctx)
        have = {key for _a, key in assignments}
        for key in sorted(want - have):
            role = roles.get(key)
            if role is None:  # the startup seed makes every role; refuse rather than half-apply
                raise AppError("ROLE_MISSING", "That staff role isn't set up yet. Restart the API once.", 409)
            await self.authz.assign_role(user_id=user_id, role_id=role.id, organization_id=None, ctx=ctx)
        await self._set_memberships(user_id, member=bool(want), actor=ctx.user_id if ctx.actor_type == "user" else None)
        new_areas = clean_areas(list(want)) if level == "STAFF" else []
        await self.audit.record_from_auth(
            ctx,
            action="staff_account.removed" if level is None else "staff_account.set",
            entity_type="User",
            entity_id=user_id,
            previous_state={"level": previous, "areas": areas_of(held) if previous == "STAFF" else []},
            new_state={"level": level, "areas": new_areas},
        )
        return Applied(previous, level, new_areas)

    def _check_level(self, level: str, areas: list[str]) -> list[str]:
        if level not in ("ADMIN", "STAFF"):
            raise _refuse("BAD_LEVEL")
        cleaned = clean_areas(areas)
        if level == "STAFF" and not cleaned:
            raise _refuse("NO_AREAS")
        return cleaned

    async def add(self, ctx: AuthContext, *, email: str, level: str, areas: list[str], note: str | None) -> dict[str, Any]:
        email_n = normalize_email(email)
        if not EMAIL_RE.match(email_n) or len(email_n) > 320:
            raise _refuse("BAD_EMAIL")
        cleaned = self._check_level(level, areas)
        perms = await self.viewer_permissions(ctx.user_id)
        user = (
            await self.session.execute(select(User).where(User.email == email_n, User.deleted_at.is_(None)))
        ).scalar_one_or_none()
        current = None
        if user is not None:
            current = level_for((await self.platform_roles([user.id])).get(user.id, set()))
        why = refusal(
            viewer_id=ctx.user_id,
            viewer_permissions=perms,
            target_id=user.id if user else None,
            current_level=current,
            new_level=level,
        )
        if why:
            raise _refuse(why)
        if user is not None and user.status in {"SUSPENDED", "CLOSED"}:
            raise _refuse("ACCOUNT_NOT_ACTIVE")
        clean_note = (note or "").strip()[:NOTE_MAX] or None
        if user is not None and user.status == "ACTIVE" and user.email_verified_at is not None:
            await self._apply(ctx, user.id, level, cleaned)
            await self._close_waiting(email_n, user.id, status="ACCEPTED")
            await self._announce(ctx, email_n, level, invite_id=None, user_id=user.id)
            return {"state": "ADDED", "user_id": user.id, "invite_id": None}
        invite = (
            await self.session.execute(
                select(StaffInvite).where(StaffInvite.email == email_n, StaffInvite.status == "WAITING").with_for_update()
            )
        ).scalar_one_or_none()
        if invite is None:
            invite = StaffInvite(email=email_n, level=level, areas=cleaned, note=clean_note, status="WAITING", created_by=ctx.user_id, updated_by=ctx.user_id)
            self.session.add(invite)
        else:
            if invite.level == "ADMIN":
                why = refusal(viewer_id=ctx.user_id, viewer_permissions=perms, target_id=None, current_level="ADMIN", new_level=level)
                if why:
                    raise _refuse(why)
            invite.level, invite.areas, invite.note, invite.updated_by = level, cleaned, clean_note, ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="staff_account.invited",
            entity_type="StaffInvite",
            entity_id=invite.id,
            new_state={"level": level, "areas": cleaned},
        )
        await self._announce(ctx, email_n, level, invite_id=invite.id, user_id=None)
        return {"state": "WAITING", "user_id": None, "invite_id": invite.id}

    async def _announce(self, ctx: AuthContext, email: str, level: str, *, invite_id: UUID | None, user_id: UUID | None) -> None:
        """Queue the 'you're on the Corner Room staff' email (sent by the worker)."""
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=STAFF_ACCOUNT_INVITED,
                producer="administration",
                aggregate_type="StaffInvite" if invite_id else "User",
                aggregate_id=invite_id or user_id or UUID(int=0),
                payload={"level": level, "invite_id": str(invite_id) if invite_id else None, "user_id": str(user_id) if user_id else None},
                occurred_at=self.clock.now(),
                actor_id=ctx.user_id,
                correlation_id=ctx.request_id,
            ),
        )

    async def change(self, ctx: AuthContext, user_id: UUID, *, level: str, areas: list[str]) -> Applied:
        cleaned = self._check_level(level, areas)
        perms = await self.viewer_permissions(ctx.user_id)
        current = level_for((await self.platform_roles([user_id])).get(user_id, set()))
        if current is None:
            raise _refuse("NOT_STAFF")
        why = refusal(viewer_id=ctx.user_id, viewer_permissions=perms, target_id=user_id, current_level=current, new_level=level)
        if why:
            raise _refuse(why)
        return await self._apply(ctx, user_id, level, cleaned)

    async def remove(self, ctx: AuthContext, user_id: UUID) -> Applied:
        perms = await self.viewer_permissions(ctx.user_id)
        current = level_for((await self.platform_roles([user_id])).get(user_id, set()))
        if current is None:
            raise _refuse("NOT_STAFF")
        why = refusal(viewer_id=ctx.user_id, viewer_permissions=perms, target_id=user_id, current_level=current, new_level=None)
        if why:
            raise _refuse(why)
        return await self._apply(ctx, user_id, None, [])

    async def cancel_invite(self, ctx: AuthContext, invite_id: UUID) -> None:
        invite = await self.session.get(StaffInvite, invite_id)
        if invite is None or invite.status != "WAITING":
            raise NotFoundError("Invite not found")
        perms = await self.viewer_permissions(ctx.user_id)
        why = refusal(viewer_id=ctx.user_id, viewer_permissions=perms, target_id=None, current_level=invite.level, new_level=None)
        if why:
            raise _refuse(why)
        invite.status = "CANCELLED"
        invite.cancelled_at = self.clock.now()
        invite.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="staff_account.invite_cancelled",
            entity_type="StaffInvite",
            entity_id=invite.id,
            previous_state={"status": "WAITING"},
            new_state={"status": "CANCELLED"},
        )

    async def _close_waiting(self, email: str, user_id: UUID, *, status: str) -> None:
        for invite in (
            await self.session.execute(select(StaffInvite).where(StaffInvite.email == email, StaffInvite.status == "WAITING"))
        ).scalars():
            invite.status = status
            invite.user_id = user_id
            invite.accepted_at = self.clock.now() if status == "ACCEPTED" else None
        await self.session.flush()

    async def claim_for_user(self, user_id: UUID) -> bool:
        """Give a waiting invite's roles to this account once its email is verified. Idempotent."""
        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None or not user.email:
            return False
        if user.status != "ACTIVE" or user.email_verified_at is None:
            return False
        invite = (
            await self.session.execute(
                select(StaffInvite)
                .where(StaffInvite.email == normalize_email(user.email), StaffInvite.status == "WAITING")
                .with_for_update(skip_locked=True)
            )
        ).scalar_one_or_none()
        if invite is None:
            return False
        ctx = system_context("staff-invite")
        current = level_for((await self.platform_roles([user.id])).get(user.id, set()))
        if current != "OWNER":
            await self._apply(ctx, user.id, invite.level, list(invite.areas or []))
        invite.status = "ACCEPTED"
        invite.user_id = user.id
        invite.accepted_at = self.clock.now()
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="staff_account.invite_accepted",
            entity_type="StaffInvite",
            entity_id=invite.id,
            new_state={"user_id": str(user.id), "level": invite.level},
            metadata={"invited_by": str(invite.created_by) if invite.created_by else None},
        )
        return True


CLAIM_EVENTS = {USER_VERIFIED, USER_REGISTERED, USER_ACTIVATED}


def invite_email(level: str, web_base_url: str) -> tuple[str, str]:
    """Subject and plain body of the 'you're on the staff' email. No personal data in it."""
    what = "an admin" if level == "ADMIN" else "a member of the staff"
    link = f"{web_base_url.rstrip('/')}/staff/sign-in"
    subject = "You're on the Corner Room staff"
    body = (
        f"Hello,\n\nYou have been added to Corner Room as {what}.\n\n"
        f"Sign in to the staff portal here: {link}\n\n"
        "Choose Continue with Google and use this email address. If you already have a Corner Room "
        "account with this address, it is the same account: everything you had stays as it was.\n\n"
        "If you weren't expecting this, you can ignore this email.\n\nCorner Room"
    )
    return subject, body


async def consume_staff_account_event(event: DomainEvent, session: AsyncSession) -> None:
    """Outbox side consumer: verified accounts pick up waiting invites; invite emails go out."""
    if event.event_type in CLAIM_EVENTS and event.aggregate_type == "User":
        await StaffAccountsService(session).claim_for_user(event.aggregate_id)
        return
    if event.event_type != STAFF_ACCOUNT_INVITED:
        return
    from cornerroom.modules.notifications.infra.email import email_sender_for

    settings = get_settings()
    sender = email_sender_for(settings)
    if sender is None:
        return
    payload = event.payload or {}
    email: str | None = None
    if payload.get("invite_id"):
        invite = await session.get(StaffInvite, UUID(payload["invite_id"]))
        if invite is None or invite.status == "CANCELLED":
            return
        email = invite.email
    elif payload.get("user_id"):
        user = await session.get(User, UUID(payload["user_id"]))
        email = user.email if user else None
    if not email:
        return
    subject, body = invite_email(str(payload.get("level") or "STAFF"), settings.web_base_url)
    try:
        await sender.send(to=email, subject=subject, body=body)
    except Exception:  # an email that fails is logged; the account is already set up
        log.warning("staff_invite_email_failed")


__all__ = ["StaffAccountsService", "consume_staff_account_event"]
