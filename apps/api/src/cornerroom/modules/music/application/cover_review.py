"""New covers for releases that are already approved or out (owner, 2026-10-28, D-COVER-01).

While a release is a draft its cover is attached at once and staff see it in the release review.
Once it is in review, approved, scheduled or released, an accepted upload waits in
`cover_pending_asset_id` and listeners keep the current cover until someone other than the uploader
(and not the release's owner or preparer, the release two-person rule) approves it. Staff send it
back with a note the artist sees. The artist can withdraw a waiting cover.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import RELEASE_COVER_CHANGED, RELEASE_COVER_REJECTED
from cornerroom.modules.documents.application.covers import CoverService
from cornerroom.modules.music.application.studio import StudioService
from cornerroom.modules.music.domain.models import Release


class CoverReviewService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.studio = StudioService(session, self.settings, self.clock)
        self.music = self.studio.music
        self.audit = self.studio.audit

    def _url(self, asset_id: UUID | None, size: int = 480) -> str | None:
        return CoverService(self.session, self.settings).signed_path(asset_id, size) if asset_id else None

    async def _item(self, release: Release) -> dict[str, Any]:
        kind, pid = self.music.profile_of(release)
        profile_name = None
        if kind is not None and pid is not None:
            _row, _org, profile_name = await self.studio._profile(kind, pid)
        return {
            "release_id": release.id,
            "title": release.title,
            "status": release.status,
            "profile_name": profile_name,
            "submitted_at": release.cover_pending_at,
            "current_cover_url": self._url(release.cover_asset_id),
            "pending_cover_url": self._url(release.cover_pending_asset_id),
            "cover_review_note": release.cover_review_note,
        }

    async def queue(self, ctx: AuthContext) -> list[dict[str, Any]]:
        """Staff: covers waiting in the active workspace, oldest first."""
        org = await self.studio._require_staff_workspace(ctx, "music.approve")
        rows = (
            await self.session.execute(
                select(Release)
                .where(Release.primary_org_id == org, Release.cover_pending_asset_id.is_not(None), Release.deleted_at.is_(None))
                .order_by(Release.cover_pending_at)
                .limit(200)
            )
        ).scalars().all()
        return [await self._item(r) for r in rows]

    async def review(self, ctx: AuthContext, release_id: UUID, *, approve: bool, note: str | None) -> dict[str, Any]:
        release = await self.music.get_release_row(release_id)
        org = release.primary_org_id
        if org is None or not await self.music._is_allowed(
            ctx.user_id, "music.approve", resource_type="release", resource_id=release.id, organization_id=org
        ):
            raise NotFoundError("Release not found")
        if release.cover_pending_asset_id is None:
            raise AppError("INVALID_TRANSITION", "No new cover is waiting for this release", 409)
        text = " ".join((note or "").split())[:2000] or None
        previous = release.cover_asset_id
        if approve:
            await self.music.assert_independent_reviewer(ctx, [release.id])
            if release.cover_pending_by == ctx.user_id:
                raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You uploaded this cover")
            release.cover_asset_id = release.cover_pending_asset_id
            release.cover_review_note = None
        else:
            if not text:
                raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
            release.cover_review_note = text
        release.cover_pending_asset_id = None
        release.cover_pending_at = None
        release.cover_pending_by = None
        await self.music._flush_versioned()
        await self.studio._event(
            RELEASE_COVER_CHANGED if approve else RELEASE_COVER_REJECTED, "Release", release.id, {}, ctx, org
        )
        await self.audit.record_from_auth(
            ctx, action="release.cover_approved" if approve else "release.cover_rejected", entity_type="Release",
            entity_id=release.id,
            previous_state={"cover_asset_id": str(previous) if previous else None},
            new_state={"cover_asset_id": str(release.cover_asset_id) if release.cover_asset_id else None, "note": text},
            organization_id=org,
        )
        return await self._item(release)

    async def withdraw(self, ctx: AuthContext, release_id: UUID) -> Release:
        release, _role = await self.studio._release(ctx, release_id)
        if release.cover_pending_asset_id is None:
            return release
        release.cover_pending_asset_id = None
        release.cover_pending_at = None
        release.cover_pending_by = None
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action="release.cover_withdrawn", entity_type="Release", entity_id=release.id, new_state={},
            organization_id=release.primary_org_id,
        )
        return release
