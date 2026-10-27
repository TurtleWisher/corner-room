"""Song lyrics (owner, 2026-10-27, D-LYRICS-01).

The artist types a song's lyrics with its other details. While the release is a draft they are
saved straight onto the track and staff read them in the release review like every other detail.
Once the song is approved or out, a change waits in `lyrics_pending` until someone other than the
artist approves it (the same two-person rule as releases). Listeners only ever see `lyrics` of a
released song.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import TRACK_LYRICS_CHANGED, TRACK_LYRICS_REJECTED, TRACK_LYRICS_SUBMITTED
from cornerroom.modules.music.application.studio import EDITABLE_RELEASE_STATUSES, EDITABLE_TRACK_STATUSES, StudioService
from cornerroom.modules.music.domain.models import Release, ReleaseTrack, Track

LYRICS_MAX_CHARS = 10_000
# Songs whose lyrics change through staff review rather than the draft editor.
REVIEWED_TRACK_STATUSES = frozenset({"APPROVED", "SCHEDULED", "RELEASED"})
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_BLANK_RUN = re.compile(r"\n{3,}")


def clean_lyrics(value: str | None) -> str | None:
    """Plain text, one line per sung line: Unix newlines, no trailing spaces or control
    characters, at most one empty line between verses. Empty means no lyrics."""
    if value is None:
        return None
    text = value.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    text = _CONTROL.sub("", text)
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    text = _BLANK_RUN.sub("\n\n", text).strip("\n")
    if not text.strip():
        return None
    if len(text) > LYRICS_MAX_CHARS:
        raise AppError("VALIDATION_ERROR", f"Lyrics can be at most {LYRICS_MAX_CHARS:,} characters", 422)
    return text


def lyrics_view(track: Track) -> dict[str, Any]:
    """What Studio and the release review show about a song's lyrics."""
    waiting = track.lyrics_pending_at is not None
    return {
        "lyrics": track.lyrics,
        "lyrics_waiting": waiting,
        "lyrics_pending": track.lyrics_pending if waiting else None,
        "lyrics_review_note": track.lyrics_review_note,
    }


class LyricsService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.studio = StudioService(session, self.settings, self.clock)
        self.music = self.studio.music
        self.audit = self.studio.audit

    async def save(self, ctx: AuthContext, track_id: UUID, lyrics: str | None) -> Track:
        """Draft songs: saved now. Approved or released songs: waits for staff."""
        track, release, role = await self.studio._track(ctx, track_id)
        text = clean_lyrics(lyrics)
        if release.status in EDITABLE_RELEASE_STATUSES and track.status in EDITABLE_TRACK_STATUSES:
            track.lyrics = text
            track.lyrics_pending = None
            track.lyrics_pending_at = None
            track.lyrics_pending_by = None
            track.updated_by = ctx.user_id
            await self.music._flush_versioned()
            await self.studio._note_staff(ctx, release, role)
            await self.audit.record_from_auth(
                ctx, action="track.lyrics_saved", entity_type="Track", entity_id=track.id,
                new_state={"has_lyrics": text is not None}, organization_id=release.primary_org_id,
            )
            return track
        if track.status not in REVIEWED_TRACK_STATUSES:
            if release.status == "METADATA_REVIEW" or track.status in {"SUBMITTED", "IN_REVIEW"}:
                raise AppError(
                    "INVALID_TRANSITION",
                    "Lyrics can't be changed while the release is in review",
                    409,
                    "Wait for the reviewer, or withdraw the release from review first",
                )
            raise AppError("INVALID_TRANSITION", "This song's lyrics can't be changed now", 409)
        if text == track.lyrics:
            # Back to what listeners already see: nothing left to review.
            track.lyrics_pending = None
            track.lyrics_pending_at = None
            track.lyrics_pending_by = None
        else:
            track.lyrics_pending = text
            track.lyrics_pending_at = self.clock.now()
            track.lyrics_pending_by = ctx.user_id
            track.lyrics_review_note = None
        track.updated_by = ctx.user_id
        await self.music._flush_versioned()
        if track.lyrics_pending_at is not None:
            await self.studio._event(
                TRACK_LYRICS_SUBMITTED, "Track", track.id, {"release_id": str(release.id)}, ctx, release.primary_org_id
            )
        await self.audit.record_from_auth(
            ctx, action="track.lyrics_submitted", entity_type="Track", entity_id=track.id,
            new_state={"waiting": track.lyrics_pending_at is not None, "has_lyrics": text is not None},
            organization_id=release.primary_org_id,
        )
        return track

    async def withdraw(self, ctx: AuthContext, track_id: UUID) -> Track:
        track, release, _role = await self.studio._track(ctx, track_id)
        if track.lyrics_pending_at is None:
            return track
        track.lyrics_pending = None
        track.lyrics_pending_at = None
        track.lyrics_pending_by = None
        track.updated_by = ctx.user_id
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action="track.lyrics_withdrawn", entity_type="Track", entity_id=track.id,
            new_state={}, organization_id=release.primary_org_id,
        )
        return track

    async def queue(self, ctx: AuthContext) -> list[dict[str, Any]]:
        """Staff: lyrics changes waiting in the active workspace, oldest first."""
        org = await self.studio._require_staff_workspace(ctx, "music.approve")
        tracks = (
            await self.session.execute(
                select(Track)
                .where(Track.primary_org_id == org, Track.lyrics_pending_at.is_not(None), Track.deleted_at.is_(None))
                .order_by(Track.lyrics_pending_at)
                .limit(200)
            )
        ).scalars().all()
        return [await self._item(track) for track in tracks]

    async def _item(self, track: Track) -> dict[str, Any]:
        release = (
            await self.session.execute(
                select(Release)
                .join(ReleaseTrack, ReleaseTrack.release_id == Release.id)
                .where(ReleaseTrack.track_id == track.id, Release.deleted_at.is_(None))
                .order_by(Release.created_at)
            )
        ).scalars().first()
        profile_name = None
        if release is not None:
            kind, pid = self.music.profile_of(release)
            if kind is not None and pid is not None:
                _row, _org, profile_name = await self.studio._profile(kind, pid)
        return {
            "track_id": track.id,
            "title": track.title,
            "status": track.status,
            "release_id": release.id if release else None,
            "release_title": release.title if release else None,
            "profile_name": profile_name,
            "submitted_at": track.lyrics_pending_at,
            **lyrics_view(track),
        }

    async def review(self, ctx: AuthContext, track_id: UUID, *, approve: bool, note: str | None) -> dict[str, Any]:
        track = await self.music.get_track_row(track_id)
        org = track.primary_org_id
        if org is None or not await self.music._is_allowed(
            ctx.user_id, "music.approve", resource_type="track", resource_id=track.id, organization_id=org
        ):
            raise NotFoundError("Track not found")
        if track.lyrics_pending_at is None:
            raise AppError("INVALID_TRANSITION", "No lyrics are waiting for this song", 409)
        text = " ".join((note or "").split())[:2000] or None
        if approve:
            releases = list(
                (await self.session.execute(select(ReleaseTrack.release_id).where(ReleaseTrack.track_id == track.id))).scalars()
            )
            await self.music.assert_independent_reviewer(ctx, releases)
            if track.lyrics_pending_by == ctx.user_id:
                raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You suggested these lyrics")
            track.lyrics = track.lyrics_pending
            track.lyrics_review_note = None
        else:
            if not text:
                raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
            track.lyrics_review_note = text
        track.lyrics_pending = None
        track.lyrics_pending_at = None
        track.lyrics_pending_by = None
        track.updated_by = ctx.user_id
        await self.music._flush_versioned()
        await self.studio._event(
            TRACK_LYRICS_CHANGED if approve else TRACK_LYRICS_REJECTED, "Track", track.id, {}, ctx, org
        )
        await self.audit.record_from_auth(
            ctx, action="track.lyrics_approved" if approve else "track.lyrics_rejected", entity_type="Track",
            entity_id=track.id, new_state={"note": text} if text else {}, organization_id=org,
        )
        return await self._item(track)
