"""One kind of artist profile, run by a team (owner, 2026-10-30, D-ARTIST-UNIFY-01).

- Every band is an artist: its row in `artists.artists` has the band's own id and kind BAND, and
  mirrors the band's name, bio, picture, label and state (domain/band_mirror.py, run before every
  flush). What only a band has (its lineup) stays on `bands`.
- Solo or band, a profile has one owner and any number of managers. Managers do and see what the
  owner does: music, files, sales, buyer names, payouts. Only the owner picks a manager, and the
  new manager waits for staff approval. The owner (or staff) can take a manager off at any time
  and a manager can leave; staff set or change the owner. Reviewers are staff with artist.manage
  in the profile's label, in that workspace, who are not on the profile's team (the same
  two-person rule as profile changes).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ConflictError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import ARTIST_TEAM_CHANGED, DomainEvent
from cornerroom.modules.artists.domain.models import Artist, ArtistTeamMember
from cornerroom.modules.audit.application.service import AuditService

OWNER = "OWNER"
MANAGER = "MANAGER"
OPEN_STATUSES = ("PENDING", "ACTIVE")
NOTE_MAX = 2000
QUEUE_LIMIT = 200


# --- who runs a profile --------------------------------------------------------------------------


async def team_user_ids(session: AsyncSession, artist_id: UUID) -> set[UUID]:
    """Everyone who runs the profile now: the owner and approved managers."""
    rows = await session.execute(
        select(ArtistTeamMember.user_id).where(
            ArtistTeamMember.artist_id == artist_id, ArtistTeamMember.status == "ACTIVE"
        )
    )
    return set(rows.scalars().all())


async def owner_user_id(session: AsyncSession, artist_id: UUID) -> UUID | None:
    return (
        await session.execute(
            select(ArtistTeamMember.user_id).where(
                ArtistTeamMember.artist_id == artist_id,
                ArtistTeamMember.role == OWNER,
                ArtistTeamMember.status == "ACTIVE",
            )
        )
    ).scalar_one_or_none()


async def acting_owner(session: AsyncSession, artist_id: UUID, user_id: UUID | None) -> UUID | None:
    """The owner id to hand the permission kernel: the caller when they run the profile."""
    if user_id is not None and user_id in await team_user_ids(session, artist_id):
        return user_id
    return await owner_user_id(session, artist_id)


async def artist_ids_run_by(session: AsyncSession, user_id: UUID) -> list[UUID]:
    """Profiles (solo or band) this account runs now, oldest first."""
    rows = await session.execute(
        select(ArtistTeamMember.artist_id)
        .join(Artist, Artist.id == ArtistTeamMember.artist_id)
        .where(
            ArtistTeamMember.user_id == user_id,
            ArtistTeamMember.status == "ACTIVE",
            Artist.deleted_at.is_(None),
        )
        .order_by(ArtistTeamMember.created_at.asc())
    )
    return list(dict.fromkeys(rows.scalars().all()))


async def make_owner(session: AsyncSession, artist_id: UUID, user_id: UUID, *, by: UUID | None) -> ArtistTeamMember:
    """Make this account the owner. The previous owner stays on as a manager (staff or the new
    owner can take them off). Already the owner: nothing changes."""
    rows = list(
        (
            await session.execute(
                select(ArtistTeamMember).where(
                    ArtistTeamMember.artist_id == artist_id,
                    ArtistTeamMember.status.in_(OPEN_STATUSES),
                )
            )
        ).scalars()
    )
    mine = next((r for r in rows if r.user_id == user_id), None)
    if mine is not None and mine.role == OWNER and mine.status == "ACTIVE":
        return mine
    for row in rows:
        if row.role == OWNER and row.status == "ACTIVE":
            row.role, row.updated_by = MANAGER, by
    await session.flush()
    if mine is None:
        mine = ArtistTeamMember(artist_id=artist_id, user_id=user_id, requested_by=by, created_by=by)
        session.add(mine)
    mine.role, mine.status, mine.updated_by = OWNER, "ACTIVE", by
    if by is not None:
        mine.reviewed_by = by
    await session.flush()
    return mine


async def add_active_manager(session: AsyncSession, artist_id: UUID, user_id: UUID, *, by: UUID | None) -> None:
    """Staff-approved access (a band admin made by staff): an active manager unless already on."""
    row = (
        await session.execute(
            select(ArtistTeamMember).where(
                ArtistTeamMember.artist_id == artist_id,
                ArtistTeamMember.user_id == user_id,
                ArtistTeamMember.status.in_(OPEN_STATUSES),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        session.add(
            ArtistTeamMember(
                artist_id=artist_id, user_id=user_id, role=MANAGER, status="ACTIVE",
                requested_by=by, reviewed_by=by, created_by=by, updated_by=by,
            )
        )
    elif row.status == "PENDING":
        row.status, row.reviewed_by, row.updated_by = "ACTIVE", by, by
    await session.flush()


async def take_off_team(session: AsyncSession, artist_id: UUID, user_id: UUID, *, by: UUID | None) -> None:
    """Staff cut someone's access to a profile (a band admin flag turned off), owner included: the
    profile then has no owner until staff name one. Owners and managers otherwise use TeamService."""
    rows = (
        await session.execute(
            select(ArtistTeamMember).where(
                ArtistTeamMember.artist_id == artist_id,
                ArtistTeamMember.user_id == user_id,
                ArtistTeamMember.status.in_(OPEN_STATUSES),
            )
        )
    ).scalars()
    for row in rows:
        row.status = "REMOVED" if row.status == "ACTIVE" else "WITHDRAWN"
        row.ended_by, row.updated_by = by, by
    await session.flush()


# --- Studio and staff actions --------------------------------------------------------------------


class TeamService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        from cornerroom.modules.artists.application.service import ArtistService

        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.artists = ArtistService(session, clock=self.clock)
        self.audit = AuditService(session)

    async def _profile(self, kind: str, pid: UUID) -> Artist:
        if kind not in {"artist", "band"}:
            raise AppError("VALIDATION_ERROR", "Profile kind must be artist or band", 422)
        artist = await self.session.get(Artist, pid)
        if artist is None or artist.deleted_at is not None or (artist.kind == "BAND") != (kind == "band"):
            raise NotFoundError("Profile not found")
        return artist

    async def _members(self, artist_id: UUID) -> list[ArtistTeamMember]:
        return list(
            (
                await self.session.execute(
                    select(ArtistTeamMember)
                    .where(ArtistTeamMember.artist_id == artist_id, ArtistTeamMember.status.in_(OPEN_STATUSES))
                    .order_by(ArtistTeamMember.created_at.asc())
                )
            ).scalars()
        )

    async def is_reviewer(self, ctx: AuthContext, artist: Artist) -> bool:
        org = artist.primary_org_id
        if org is None or ctx.organization_id != org:
            return False
        if ctx.user_id in await team_user_ids(self.session, artist.id):
            return False
        return await self.artists._is_allowed(
            ctx.user_id, "artist.manage", resource_type="artist", resource_id=artist.id, organization_id=org
        )

    async def _people(self, user_ids: set[UUID]) -> dict[UUID, tuple[str | None, str | None]]:
        """(name, email) per account; the name is the one on their customer profile."""
        from cornerroom.modules.identity.domain.models import CustomerProfile, User

        if not user_ids:
            return {}
        rows = await self.session.execute(
            select(User.id, User.email, CustomerProfile.display_name)
            .outerjoin(
                CustomerProfile,
                (CustomerProfile.user_id == User.id) & CustomerProfile.deleted_at.is_(None),
            )
            .where(User.id.in_(user_ids))
        )
        return {uid: (name, email) for uid, email, name in rows.all()}

    def _member_view(self, row: ArtistTeamMember, people: dict[UUID, tuple[str | None, str | None]]) -> dict[str, Any]:
        name, email = people.get(row.user_id, (None, None))
        return {
            "id": row.id,
            "user_id": row.user_id,
            "display_name": name,
            "email": email,
            "role": row.role,
            "status": row.status,
            "requested_at": row.created_at,
            "reviewed_at": row.reviewed_at,
        }

    async def _team_view(self, artist: Artist, ctx: AuthContext) -> dict[str, Any]:
        members = await self._members(artist.id)
        people = await self._people({m.user_id for m in members})
        mine = next((m for m in members if m.user_id == ctx.user_id and m.status == "ACTIVE"), None)
        return {
            "profile": {
                "kind": "band" if artist.kind == "BAND" else "artist",
                "id": artist.id,
                "display_name": artist.stage_name,
            },
            "my_role": mine.role if mine else None,
            "can_pick_managers": mine is not None and mine.role == OWNER,
            "members": [self._member_view(m, people) for m in members],
        }

    async def view(self, ctx: AuthContext, kind: str, pid: UUID) -> dict[str, Any]:
        artist = await self._profile(kind, pid)
        if ctx.user_id not in await team_user_ids(self.session, artist.id) and not await self.is_reviewer(ctx, artist):
            raise NotFoundError("Profile not found")
        return await self._team_view(artist, ctx)

    async def pick_manager(self, ctx: AuthContext, kind: str, pid: UUID, email: str) -> dict[str, Any]:
        from cornerroom.modules.identity.domain.models import User

        artist = await self._profile(kind, pid)
        if await owner_user_id(self.session, artist.id) != ctx.user_id:
            if ctx.user_id in await team_user_ids(self.session, artist.id):
                raise AppError("OWNER_ONLY", "Only the owner can add managers", 403)
            raise NotFoundError("Profile not found")
        wanted = email.strip().lower()
        user = (
            await self.session.execute(select(User).where(User.email == wanted, User.deleted_at.is_(None)))
        ).scalar_one_or_none()
        if user is None or user.status != "ACTIVE":
            raise AppError(
                "ACCOUNT_NOT_FOUND", "No Corner Room account uses this email", 422,
                "Ask them to create an account with this email first",
            )
        if any(m.user_id == user.id for m in await self._members(artist.id)):
            raise ConflictError("This account is already on the team or waiting for approval")
        row = ArtistTeamMember(
            artist_id=artist.id, user_id=user.id, role=MANAGER, status="PENDING",
            requested_by=ctx.user_id, created_by=ctx.user_id, updated_by=ctx.user_id,
        )
        self.session.add(row)
        await self.session.flush()
        await self._record(ctx, artist, row, "artist.team_manager_picked", None)
        return await self._team_view(artist, ctx)

    async def take_off(self, ctx: AuthContext, kind: str, pid: UUID, member_id: UUID) -> dict[str, Any]:
        """The owner takes a manager off or withdraws a waiting pick; a manager leaves; staff may
        take any manager off. The owner is changed by staff, never removed."""
        artist = await self._profile(kind, pid)
        row = await self.session.get(ArtistTeamMember, member_id)
        if row is None or row.artist_id != artist.id or row.status not in OPEN_STATUSES:
            raise NotFoundError("Team member not found")
        owner = await owner_user_id(self.session, artist.id)
        allowed = ctx.user_id == owner or row.user_id == ctx.user_id or await self.is_reviewer(ctx, artist)
        if not allowed:
            raise NotFoundError("Team member not found")
        if row.role == OWNER:
            raise AppError("OWNER_STAYS", "The owner can't be taken off", 409, "Staff can make someone else the owner")
        previous = row.status
        row.status = "REMOVED" if previous == "ACTIVE" else "WITHDRAWN"
        row.ended_by, row.ended_at, row.updated_by = ctx.user_id, self.clock.now(), ctx.user_id
        await self.session.flush()
        await self._record(ctx, artist, row, f"artist.team_member_{row.status.lower()}", previous)
        return await self._team_view(artist, ctx)

    async def queue(self, ctx: AuthContext) -> list[dict[str, Any]]:
        rows = list(
            (
                await self.session.execute(
                    select(ArtistTeamMember)
                    .where(ArtistTeamMember.status == "PENDING")
                    .order_by(ArtistTeamMember.created_at.asc())
                    .limit(QUEUE_LIMIT * 5)
                )
            ).scalars()
        )
        people = await self._people({r.user_id for r in rows} | {r.requested_by for r in rows if r.requested_by})
        out: list[dict[str, Any]] = []
        for row in rows:
            artist = await self.session.get(Artist, row.artist_id)
            if artist is None or artist.deleted_at is not None or not await self.is_reviewer(ctx, artist):
                continue
            picked_name, picked_email = people.get(row.requested_by, (None, None)) if row.requested_by else (None, None)
            out.append(
                {
                    **self._member_view(row, people),
                    "profile": {
                        "kind": "band" if artist.kind == "BAND" else "artist",
                        "id": artist.id,
                        "display_name": artist.stage_name,
                    },
                    "picked_by": picked_name or picked_email,
                }
            )
            if len(out) >= QUEUE_LIMIT:
                break
        return out

    async def review(self, ctx: AuthContext, member_id: UUID, action: str, note: str | None) -> dict[str, Any]:
        row = (
            await self.session.execute(
                select(ArtistTeamMember).where(ArtistTeamMember.id == member_id).with_for_update()
            )
        ).scalar_one_or_none()
        if row is None:
            raise NotFoundError("Request not found")
        artist = await self.session.get(Artist, row.artist_id)
        if artist is None or artist.deleted_at is not None:
            raise NotFoundError("Request not found")
        if ctx.user_id in await team_user_ids(self.session, artist.id):
            raise AppError(
                "SAME_PERSON_REVIEW", "Someone else must approve this", 403,
                "The people who run a profile can't approve its managers",
            )
        if not await self.is_reviewer(ctx, artist):
            raise NotFoundError("Request not found")
        if action not in {"approve", "reject"}:
            raise AppError("VALIDATION_ERROR", "Action must be approve or reject", 422)
        if row.status != "PENDING":
            raise AppError("INVALID_TRANSITION", "This request has already been decided", 409)
        clean_note = (note or "").strip()[:NOTE_MAX] or None
        if action == "reject" and clean_note is None:
            raise AppError("VALIDATION_ERROR", "Tell the owner why", 422, "A note is required to turn a manager down")
        row.status = "ACTIVE" if action == "approve" else "REJECTED"
        row.reviewed_by, row.reviewed_at, row.review_note = ctx.user_id, self.clock.now(), clean_note
        row.updated_by = ctx.user_id
        await self.session.flush()
        await self._record(ctx, artist, row, f"artist.team_manager_{'approved' if action == 'approve' else 'rejected'}", "PENDING")
        people = await self._people({row.user_id})
        return self._member_view(row, people)

    async def set_owner(self, ctx: AuthContext, artist_id: UUID, email: str) -> dict[str, Any]:
        """Staff make an account the owner (for example a band's official email account)."""
        from cornerroom.modules.identity.domain.models import User

        artist = await self.session.get(Artist, artist_id)
        if artist is None or artist.deleted_at is not None or not await self._is_label_staff(ctx, artist):
            raise NotFoundError("Artist not found")
        user = (
            await self.session.execute(
                select(User).where(User.email == email.strip().lower(), User.deleted_at.is_(None))
            )
        ).scalar_one_or_none()
        if user is None or user.status != "ACTIVE":
            raise AppError(
                "ACCOUNT_NOT_FOUND", "No Corner Room account uses this email", 422,
                "Ask them to create an account with this email first",
            )
        previous = await owner_user_id(self.session, artist.id)
        row = await make_owner(self.session, artist.id, user.id, by=ctx.user_id)
        await self._record(ctx, artist, row, "artist.team_owner_set", str(previous) if previous else None)
        return await self._team_view(artist, ctx)

    async def staff_view(self, ctx: AuthContext, artist_id: UUID) -> dict[str, Any]:
        artist = await self.session.get(Artist, artist_id)
        if artist is None or artist.deleted_at is not None or not await self._is_label_staff(ctx, artist):
            raise NotFoundError("Artist not found")
        return await self._team_view(artist, ctx)

    async def _is_label_staff(self, ctx: AuthContext, artist: Artist) -> bool:
        org = artist.primary_org_id
        if org is None or ctx.organization_id != org:
            return False
        return await self.artists._is_allowed(
            ctx.user_id, "artist.manage", resource_type="artist", resource_id=artist.id, organization_id=org
        )

    async def _record(
        self, ctx: AuthContext, artist: Artist, row: ArtistTeamMember, action: str, previous: str | None
    ) -> None:
        state = {"artist_id": str(artist.id), "user_id": str(row.user_id), "role": row.role, "status": row.status}
        await self.audit.record_from_auth(
            ctx, action=action, entity_type="ArtistTeamMember", entity_id=row.id,
            previous_state={"status": previous} if previous else None, new_state=state,
            organization_id=artist.primary_org_id,
        )
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=ARTIST_TEAM_CHANGED,
                producer="artists",
                aggregate_type="Artist",
                aggregate_id=artist.id,
                payload=state,
                occurred_at=self.clock.now(),
                actor_id=ctx.user_id,
                organization_id=artist.primary_org_id,
                correlation_id=ctx.request_id,
            ),
        )
