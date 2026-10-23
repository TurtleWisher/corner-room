"""Artists and band admins change their own public profile; staff approve it first.

Owner, 2026-10-23: "A user or an artist can edit their own profile like changing/uploading profile
pic, edit details, save details" and staff approve an artist's new name, bio or picture before the
public sees it. The asker saves into one waiting request per profile (saving again updates it);
an accepted picture upload joins that request (the worker calls `attach_uploaded_portrait`).
Reviewers are staff with artist.manage in the profile's label, acting in that workspace, who are
not owners of the profile (the same two-person rule as release review). Approving applies the
change through ArtistService, so its checks, audit and versioning hold.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    ARTIST_PROFILE_CHANGE_REJECTED,
    ARTIST_PROFILE_CHANGE_SUBMITTED,
    ARTIST_PROFILE_CHANGED,
    DomainEvent,
)
from cornerroom.modules.artists.application.service import ArtistService
from cornerroom.modules.artists.domain.models import Artist, Band, ProfileChangeRequest
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.documents.domain.models import MediaAsset

PROFILE_KINDS = frozenset({"artist", "band"})
PORTRAIT_TARGETS = {"artist": "artist_portrait", "band": "band_portrait"}
USABLE_PICTURE = frozenset({"ACCEPTED", "READY"})
NAME_MAX = 200
BIO_MAX = 8000  # same limits as PATCH /artists and /bands
NOTE_MAX = 2000
QUEUE_LIMIT = 200


def _clean_name(value: str) -> str:
    name = " ".join(value.split())
    if not name:
        raise AppError("VALIDATION_ERROR", "The name can't be empty", 422)
    if len(name) > NAME_MAX:
        raise AppError("VALIDATION_ERROR", f"The name can be at most {NAME_MAX} characters", 422)
    return name


def _clean_bio(value: str | None) -> str | None:
    if value is None:
        return None
    bio = value.strip()
    if len(bio) > BIO_MAX:
        raise AppError("VALIDATION_ERROR", f"The bio can be at most {BIO_MAX} characters", 422)
    return bio or None


class ProfileChangeService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.artists = ArtistService(session, clock=self.clock)
        self.audit = AuditService(session)

    # --- profiles and who may act -----------------------------------------------------------

    async def _profile(self, kind: str, pid: UUID) -> Artist | Band:
        if kind not in PROFILE_KINDS:
            raise AppError("VALIDATION_ERROR", "Profile kind must be artist or band", 422)
        row = await self.session.get(Artist if kind == "artist" else Band, pid)
        if row is None or row.deleted_at is not None:
            raise NotFoundError("Profile not found")
        return row

    @staticmethod
    def _name(row: Artist | Band) -> str:
        return row.stage_name if isinstance(row, Artist) else row.name

    async def owner_ids(self, kind: str, pid: UUID) -> set[UUID]:
        """The people who run this profile in Studio (ACTIVE profiles only, as for publishing)."""
        from cornerroom.modules.music.application.service import MusicService

        music = MusicService(self.session, settings=self.settings, clock=self.clock)
        return await music.catalog_owner_ids(pid if kind == "artist" else None, pid if kind == "band" else None)

    async def is_reviewer(self, ctx: AuthContext, kind: str, row: Artist | Band) -> bool:
        org = row.primary_org_id
        if org is not None and ctx.organization_id != org:
            return False
        if ctx.user_id in await self.owner_ids(kind, row.id):
            return False
        return await self.artists._is_allowed(
            ctx.user_id, "artist.manage", resource_type=kind, resource_id=row.id, organization_id=org
        )

    async def _owned(self, ctx: AuthContext, kind: str, pid: UUID) -> Artist | Band:
        row = await self._profile(kind, pid)
        if ctx.user_id not in await self.owner_ids(kind, pid):
            raise NotFoundError("Profile not found")
        return row

    async def assert_portrait_upload(self, ctx: AuthContext, kind: str, pid: UUID) -> Artist | Band:
        """Uploads of a new picture: the profile's owners only (it then waits for review)."""
        row = await self._owned(ctx, kind, pid)
        self._assert_editable(row)
        return row

    @staticmethod
    def _assert_editable(row: Artist | Band) -> None:
        if isinstance(row, Artist) and row.status in {"TERMINATED", "REJECTED"}:
            raise AppError("INVALID_TRANSITION", "This profile can't be edited in its current state", 409)
        if isinstance(row, Band) and row.status == "DISBANDED":
            raise AppError("INVALID_TRANSITION", "This profile can't be edited in its current state", 409)

    # --- reading -------------------------------------------------------------------------------

    async def _open(self, kind: str, pid: UUID, *, lock: bool = False) -> ProfileChangeRequest | None:
        stmt = select(ProfileChangeRequest).where(
            ProfileChangeRequest.profile_type == kind,
            ProfileChangeRequest.profile_id == pid,
            ProfileChangeRequest.status == "PENDING",
        )
        if lock:
            stmt = stmt.with_for_update()
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def _last_decision(self, kind: str, pid: UUID) -> ProfileChangeRequest | None:
        return (
            await self.session.execute(
                select(ProfileChangeRequest)
                .where(
                    ProfileChangeRequest.profile_type == kind,
                    ProfileChangeRequest.profile_id == pid,
                    ProfileChangeRequest.status.in_(("APPROVED", "REJECTED")),
                )
                .order_by(ProfileChangeRequest.reviewed_at.desc().nulls_last())
                .limit(1)
            )
        ).scalar_one_or_none()

    def _picture_url(self, asset_id: UUID | None) -> str | None:
        if asset_id is None:
            return None
        from cornerroom.modules.documents.application.covers import CoverService

        return CoverService(self.session, self.settings).signed_path(asset_id, 480)

    def _request_view(self, req: ProfileChangeRequest) -> dict[str, Any]:
        return {
            "id": req.id,
            "status": req.status,
            "stage_name": req.stage_name,
            "bio": req.bio,
            "bio_changed": req.bio_changed,
            "portrait_url": self._picture_url(req.portrait_asset_id),
            "remove_portrait": req.remove_portrait,
            "submitted_at": req.submitted_at,
            "reviewed_at": req.reviewed_at,
            "review_note": req.review_note,
        }

    def _current_view(self, kind: str, row: Artist | Band) -> dict[str, Any]:
        return {
            "kind": kind,
            "id": row.id,
            "status": row.status,
            "stage_name": self._name(row),
            "bio": row.bio,
            "portrait_url": self._picture_url(row.portrait_asset_id),
        }

    async def view(self, ctx: AuthContext, kind: str, pid: UUID) -> dict[str, Any]:
        """What Studio shows: the public profile now, what is waiting for review, the last decision
        and the checks on the latest picture upload."""
        from cornerroom.modules.documents.application.covers import latest_artwork_report

        row = await self._owned(ctx, kind, pid)
        pending = await self._open(kind, pid)
        decided = await self._last_decision(kind, pid)
        report = await latest_artwork_report(
            self.session,
            target_type=PORTRAIT_TARGETS[kind],
            target_id=pid,
            current_asset_id=(pending.portrait_asset_id if pending else None) or row.portrait_asset_id,
        )
        return {
            "profile": self._current_view(kind, row),
            "pending": self._request_view(pending) if pending else None,
            "last_decision": self._request_view(decided) if decided else None,
            "picture_report": report,
        }

    # --- asking ----------------------------------------------------------------------------------

    async def _new_request(self, kind: str, row: Artist | Band, user_id: UUID) -> ProfileChangeRequest:
        req = ProfileChangeRequest(
            profile_type=kind,
            profile_id=row.id,
            organization_id=row.primary_org_id,
            status="PENDING",
            requested_by=user_id,
            created_by=user_id,
        )
        self.session.add(req)
        return req

    async def _submitted(self, req: ProfileChangeRequest, user_id: UUID, kind: str, ctx: AuthContext | None) -> None:
        req.submitted_at = self.clock.now()
        req.updated_by = user_id
        await self.session.flush()
        state = {
            "stage_name": req.stage_name,
            "bio_changed": req.bio_changed,
            "portrait": str(req.portrait_asset_id) if req.portrait_asset_id else None,
            "remove_portrait": req.remove_portrait,
        }
        if ctx is not None:
            await self.audit.record_from_auth(
                ctx, action="artist.profile_change_submitted", entity_type="ProfileChangeRequest",
                entity_id=req.id, new_state=state, organization_id=req.organization_id,
            )
        else:
            await self.audit.record(
                action="artist.profile_change_submitted", entity_type="ProfileChangeRequest",
                entity_id=req.id, actor_id=str(user_id), new_state=state, organization_id=req.organization_id,
            )
        await self._emit(ARTIST_PROFILE_CHANGE_SUBMITTED, kind, req, actor_id=user_id, request_id=ctx.request_id if ctx else None)

    async def save(
        self,
        ctx: AuthContext,
        kind: str,
        pid: UUID,
        *,
        stage_name: str | None = None,
        bio: str | None | object = ...,
        remove_portrait: bool = False,
    ) -> dict[str, Any]:
        """Save what the owner wants changed; it waits for staff. Fields left out keep what is
        waiting already (or what is public)."""
        row = await self._owned(ctx, kind, pid)
        self._assert_editable(row)
        req = await self._open(kind, pid, lock=True)
        if stage_name is not None:
            # None on the request means "keep the public name".
            wanted = _clean_name(stage_name)
            new_name = None if wanted == self._name(row) else wanted
            if new_name is not None:
                req = req or await self._new_request(kind, row, ctx.user_id)
            if req is not None:
                req.stage_name = new_name
        if bio is not ...:
            new_bio = _clean_bio(bio if isinstance(bio, str) else None)
            if new_bio != row.bio:
                req = req or await self._new_request(kind, row, ctx.user_id)
                req.bio, req.bio_changed = new_bio, True
            elif req is not None:
                req.bio, req.bio_changed = None, False
        if remove_portrait:
            if row.portrait_asset_id is None and (req is None or req.portrait_asset_id is None):
                pass  # nothing to remove
            else:
                req = req or await self._new_request(kind, row, ctx.user_id)
                req.portrait_asset_id, req.remove_portrait = None, row.portrait_asset_id is not None
        if req is None:
            raise AppError("NOTHING_TO_CHANGE", "Nothing has changed", 422, "Change the name, bio or picture first")
        if not (req.stage_name or req.bio_changed or req.portrait_asset_id or req.remove_portrait):
            # Everything matches the public profile again: nothing is left to review.
            req.status = "WITHDRAWN"
            req.updated_by = ctx.user_id
            await self.session.flush()
            return await self.view(ctx, kind, pid)
        await self._submitted(req, ctx.user_id, kind, ctx)
        return await self.view(ctx, kind, pid)

    async def attach_uploaded_portrait(self, kind: str, pid: UUID, asset_id: UUID, user_id: UUID) -> None:
        """Worker: a new picture passed the checks; it joins the profile's waiting request."""
        row = await self.session.get(Artist if kind == "artist" else Band, pid)
        if row is None or row.deleted_at is not None:
            return
        req = await self._open(kind, pid, lock=True) or await self._new_request(kind, row, user_id)
        req.portrait_asset_id, req.remove_portrait = asset_id, False
        await self._submitted(req, user_id, kind, None)

    # --- deciding --------------------------------------------------------------------------------

    async def queue(self, ctx: AuthContext) -> list[dict[str, Any]]:
        """Waiting requests this reviewer may decide, oldest first."""
        rows = (
            await self.session.execute(
                select(ProfileChangeRequest)
                .where(ProfileChangeRequest.status == "PENDING")
                .order_by(ProfileChangeRequest.submitted_at.asc().nulls_last(), ProfileChangeRequest.created_at.asc())
                .limit(QUEUE_LIMIT * 5)
            )
        ).scalars().all()
        out: list[dict[str, Any]] = []
        for req in rows:
            row = await self.session.get(Artist if req.profile_type == "artist" else Band, req.profile_id)
            if row is None or row.deleted_at is not None or not await self.is_reviewer(ctx, req.profile_type, row):
                continue
            out.append({"request": self._request_view(req), "profile": self._current_view(req.profile_type, row)})
            if len(out) >= QUEUE_LIMIT:
                break
        return out

    async def transition(self, ctx: AuthContext, request_id: UUID, to: str, note: str | None = None) -> dict[str, Any]:
        req = (
            await self.session.execute(
                select(ProfileChangeRequest).where(ProfileChangeRequest.id == request_id).with_for_update()
            )
        ).scalar_one_or_none()
        if req is None:
            raise NotFoundError("Request not found")
        kind = req.profile_type
        row = await self._profile(kind, req.profile_id)
        owners = await self.owner_ids(kind, row.id)
        if to == "WITHDRAWN":
            if ctx.user_id not in owners:
                raise NotFoundError("Request not found")
        elif to in {"APPROVED", "REJECTED"}:
            if ctx.user_id in owners:
                raise AppError(
                    "SAME_PERSON_REVIEW", "Someone else must approve this", 403,
                    "The people who run a profile can't approve its changes",
                )
            if not await self.is_reviewer(ctx, kind, row):
                raise NotFoundError("Request not found")
        else:
            raise AppError("VALIDATION_ERROR", "Unknown status", 422)
        if req.status != "PENDING":
            raise AppError("INVALID_TRANSITION", "This request has already been decided", 409)
        clean_note = (note or "").strip()[:NOTE_MAX] or None
        if to == "REJECTED" and clean_note is None:
            raise AppError("VALIDATION_ERROR", "Tell the artist why", 422, "A note is required to turn a change down")
        if to == "APPROVED":
            await self._apply(ctx, kind, row, req)
        req.status = to
        req.updated_by = ctx.user_id
        if to != "WITHDRAWN":
            req.reviewed_by, req.reviewed_at, req.review_note = ctx.user_id, self.clock.now(), clean_note
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx, action=f"artist.profile_change_{to.lower()}", entity_type="ProfileChangeRequest",
            entity_id=req.id, previous_state={"status": "PENDING"}, new_state={"status": to},
            organization_id=req.organization_id,
        )
        if to == "APPROVED":
            await self._emit(ARTIST_PROFILE_CHANGED, kind, req, actor_id=ctx.user_id, request_id=ctx.request_id)
        elif to == "REJECTED":
            await self._emit(ARTIST_PROFILE_CHANGE_REJECTED, kind, req, actor_id=ctx.user_id, request_id=ctx.request_id)
        return {"request": self._request_view(req), "profile": self._current_view(kind, row)}

    async def _apply(self, ctx: AuthContext, kind: str, row: Artist | Band, req: ProfileChangeRequest) -> None:
        changes: dict[str, Any] = {}
        if req.stage_name:
            changes["stage_name" if kind == "artist" else "name"] = req.stage_name
        if req.bio_changed:
            changes["bio"] = req.bio
        if req.portrait_asset_id is not None:
            asset = await self.session.get(MediaAsset, req.portrait_asset_id)
            if asset is None or asset.status not in USABLE_PICTURE:
                raise AppError("INVALID_TRANSITION", "The new picture is still being checked", 409)
            changes["portrait_asset_id"] = asset.id
        elif req.remove_portrait:
            changes["portrait_asset_id"] = None
        if kind == "artist":
            await self.artists.update_artist(ctx, row.id, **changes)
        else:
            await self.artists.update_band(ctx, row.id, **changes)

    async def _emit(
        self, event_type: str, kind: str, req: ProfileChangeRequest, *, actor_id: UUID, request_id: str | None
    ) -> None:
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type,
                producer="artists",
                aggregate_type="Artist" if kind == "artist" else "Band",
                aggregate_id=req.profile_id,
                payload={"request_id": str(req.id), "status": req.status},
                occurred_at=self.clock.now(),
                actor_id=actor_id,
                organization_id=req.organization_id,
                correlation_id=request_id,
            ),
        )
