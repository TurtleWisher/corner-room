"""Song lyrics (owner, 2026-10-27, D-LYRICS-01).

The artist types a song's lyrics with its other details. While the release is a draft they are
saved straight onto the track and staff read them in the release review like every other detail.
Once the song is approved or out, a change waits in `lyrics_pending` until someone other than the
artist approves it (the same two-person rule as releases). Listeners only ever see `lyrics` of a
released song.

Lyric timings (owner, 2026-11-01, D-LYRICS-03): staff tap along to a released song once per sung
line, and `lyrics_timings` keeps when each line starts (milliseconds). They belong to the text:
when the number of sung lines changes, the timings are dropped and the room paces the lines again.

Staff lyrics sync (owner, 2026-11-21, D-LYRICS-04): staff find a released song by its title or its
act's name, and on the same page fix its words (wording, spacing, lines) while they time them. The
words are the song's own `lyrics`, so the song page, the listening room and Studio all show the fix.
A staff member on the act's own team waits like any artist (D-REVIEW-ARTIST-01) and approves the
change from the staff side.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.infra.review_policy import approve_at_once, approves_at_once, second_review_on
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import TRACK_LYRICS_CHANGED, TRACK_LYRICS_REJECTED, TRACK_LYRICS_SUBMITTED
from cornerroom.modules.music.application.studio import EDITABLE_RELEASE_STATUSES, EDITABLE_TRACK_STATUSES, StudioService
from cornerroom.modules.artists.domain.models import Artist
from cornerroom.modules.music.domain.models import Release, ReleaseTrack, Track

LYRICS_MAX_CHARS = 10_000
# How many songs one staff lyrics search lists.
SONG_SEARCH_LIMIT = 30
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


# A song's start times are kept to the millisecond, at most a day in.
_TIMING_MAX_MS = 24 * 60 * 60 * 1000


def sung_lines(text: str | None) -> list[str]:
    """The lines that are sung, in order: empty lines between verses are not lines."""
    return [line.strip() for line in (text or "").splitlines() if line.strip()]


def timings_for(lyrics: str | None, timings: Any) -> list[int] | None:
    """The stored start times when they still fit the lyrics (one per sung line), else None."""
    if not isinstance(timings, list) or not timings:
        return None
    if len(timings) != len(sung_lines(lyrics)):
        return None
    return [int(t) for t in timings]


def clean_timings(times: list[int], lyrics: str | None) -> list[int]:
    """One start per sung line, in milliseconds, never going backwards."""
    count = len(sung_lines(lyrics))
    if count == 0:
        raise AppError("INVALID_TRANSITION", "This song has no lyrics to time", 409)
    if len(times) != count:
        raise AppError("VALIDATION_ERROR", f"Give one time for each of the {count} lines", 422)
    previous = 0
    for t in times:
        if t < 0 or t > _TIMING_MAX_MS:
            raise AppError("VALIDATION_ERROR", "A line's time is outside the song", 422)
        if t < previous:
            raise AppError("VALIDATION_ERROR", "Each line must start at or after the one before", 422)
        previous = t
    return list(times)


def _drop_stale_timings(track: Track) -> None:
    if track.lyrics_timings is not None and timings_for(track.lyrics, track.lyrics_timings) is None:
        track.lyrics_timings = None


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
            _drop_stale_timings(track)
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
            if second_review_on(self.settings) and track.lyrics_pending_by == ctx.user_id:
                raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You suggested these lyrics")
            track.lyrics = track.lyrics_pending
            _drop_stale_timings(track)
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

    async def _staff_track(self, ctx: AuthContext, track_id: UUID) -> Track:
        """A song staff may work on (music.approve in its organization). Anyone else: 404."""
        track = await self.music.get_track_row(track_id)
        org = track.primary_org_id
        if org is None or not await self.music._is_allowed(
            ctx.user_id, "music.approve", resource_type="track", resource_id=track.id, organization_id=org
        ):
            raise NotFoundError("Track not found")
        return track

    async def save_timings(self, ctx: AuthContext, track_id: UUID, times: list[int] | None) -> dict[str, Any]:
        """Staff (music.approve): when each line of a released song's lyrics starts, or None to go
        back to pacing the lines across the song (D-LYRICS-03). The words themselves don't change."""
        track = await self._staff_track(ctx, track_id)
        if track.status != "RELEASED":
            raise AppError("INVALID_TRANSITION", "Only songs that are out can have their lyrics timed", 409)
        track.lyrics_timings = None if times is None else clean_timings(times, track.lyrics)
        track.updated_by = ctx.user_id
        await self.music._flush_versioned()
        await self._audit_timed(ctx, track)
        return {"track_id": track.id, "lyrics": track.lyrics, "lyrics_timings_ms": track.lyrics_timings}

    async def _audit_timed(self, ctx: AuthContext, track: Track) -> None:
        await self.audit.record_from_auth(
            ctx, action="track.lyrics_timed", entity_type="Track", entity_id=track.id,
            new_state={"lines_timed": len(track.lyrics_timings or [])}, organization_id=track.primary_org_id,
        )

    # --- staff lyrics sync (D-LYRICS-04) --------------------------------------------------------

    async def staff_songs(self, ctx: AuthContext, query: str | None) -> list[dict[str, Any]]:
        """Released songs in the staff member's workspace whose title or act's name matches,
        newest first. Without music.approve there: 404."""
        org = ctx.organization_id
        if org is None or not await self.music._is_allowed(
            ctx.user_id, "music.approve", resource_type="release", resource_id=org, organization_id=org
        ):
            raise NotFoundError("Not found")
        words = " ".join((query or "").split())[:100].split()[:6]
        stmt = select(Track).where(Track.primary_org_id == org, Track.status == "RELEASED", Track.deleted_at.is_(None))
        # Every word matches the title or the act's name, so "kaal stop" finds Kaal Bela's "Last Stop".
        for word in words:
            like = "%" + word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            acts = select(Artist.id).where(Artist.stage_name.ilike(like, escape="\\"), Artist.deleted_at.is_(None))
            stmt = stmt.where(
                or_(
                    Track.title.ilike(like, escape="\\"),
                    Track.primary_artist_id.in_(acts),
                    Track.primary_band_id.in_(acts),
                )
            )
        tracks = list(
            (
                await self.session.execute(
                    stmt.order_by(Track.created_at.desc(), Track.id).limit(SONG_SEARCH_LIMIT)
                )
            ).scalars()
        )
        names = await self._act_names(tracks)
        releases = await self._first_releases([t.id for t in tracks])
        return [
            {
                "track_id": t.id,
                "title": t.title,
                "profile_name": names.get(t.primary_artist_id or t.primary_band_id),  # type: ignore[arg-type]
                "release_title": releases.get(t.id),
                "lines": len(sung_lines(t.lyrics)),
                "timed": timings_for(t.lyrics, t.lyrics_timings) is not None,
                "lyrics_waiting": t.lyrics_pending_at is not None,
            }
            for t in tracks
        ]

    async def _act_names(self, tracks: list[Track]) -> dict[UUID, str]:
        # A band's id is also its artist row's id (D-ARTIST-UNIFY-01).
        ids = {t.primary_artist_id or t.primary_band_id for t in tracks} - {None}
        if not ids:
            return {}
        rows = (await self.session.execute(select(Artist.id, Artist.stage_name).where(Artist.id.in_(ids)))).all()
        return {row.id: row.stage_name for row in rows}

    async def _first_releases(self, track_ids: list[UUID]) -> dict[UUID, str]:
        if not track_ids:
            return {}
        rows = (
            await self.session.execute(
                select(ReleaseTrack.track_id, Release.title)
                .join(Release, Release.id == ReleaseTrack.release_id)
                .where(ReleaseTrack.track_id.in_(track_ids), Release.deleted_at.is_(None))
                .order_by(Release.created_at)
            )
        ).all()
        out: dict[UUID, str] = {}
        for row in rows:
            out.setdefault(row.track_id, row.title)
        return out

    async def staff_read(self, ctx: AuthContext, track_id: UUID) -> dict[str, Any]:
        """What the staff sync page needs: the live words and times, and any change waiting."""
        track = await self._staff_track(ctx, track_id)
        names = await self._act_names([track])
        act = track.primary_artist_id or track.primary_band_id
        waiting = track.lyrics_pending_at is not None
        return {
            "track_id": track.id,
            "title": track.title,
            "status": track.status,
            "profile_name": names.get(act) if act else None,
            "lyrics": track.lyrics,
            "lyrics_timings_ms": timings_for(track.lyrics, track.lyrics_timings),
            "lyrics_waiting": waiting,
            "lyrics_pending": track.lyrics_pending if waiting else None,
            "waiting_from_me": waiting and track.lyrics_pending_by == ctx.user_id,
            "approves_at_once": await approves_at_once(self.session, ctx, act, settings=self.settings),
        }

    async def staff_edit(
        self, ctx: AuthContext, track_id: UUID, lyrics: str | None, times: list[int] | None
    ) -> dict[str, Any]:
        """Staff change a released song's words, and with them its timings when every line is
        timed (`times`; None keeps the stored times while they still fit the words). Staff outside
        the act's team change the words at once; anyone on its team waits for approval (from the
        staff side), and the times are not kept until then. Someone else's change already waiting
        must be reviewed first, so it is never silently replaced."""
        track = await self._staff_track(ctx, track_id)
        if track.status != "RELEASED":
            raise AppError("INVALID_TRANSITION", "Only songs that are out can be worked on here", 409)
        if track.lyrics_pending_at is not None and track.lyrics_pending_by != ctx.user_id:
            raise AppError(
                "LYRICS_WAITING", "A lyrics change for this song is waiting for review", 409,
                "Approve it or send it back first",
            )
        text = clean_lyrics(lyrics)
        timed = None if times is None else clean_timings(times, text)
        if text == track.lyrics:
            # The words listeners already see: only the times can change.
            track.lyrics_pending = None
            track.lyrics_pending_at = None
            track.lyrics_pending_by = None
            if timed is not None:
                track.lyrics_timings = timed
            track.updated_by = ctx.user_id
            await self.music._flush_versioned()
            if timed is not None:
                await self._audit_timed(ctx, track)
            return await self.staff_read(ctx, track_id)

        org = track.primary_org_id
        track.lyrics_pending = text
        track.lyrics_pending_at = self.clock.now()
        track.lyrics_pending_by = ctx.user_id
        track.lyrics_review_note = None
        track.updated_by = ctx.user_id
        await self.music._flush_versioned()
        await self.studio._event(TRACK_LYRICS_SUBMITTED, "Track", track.id, {}, ctx, org)
        await self.audit.record_from_auth(
            ctx, action="track.lyrics_submitted", entity_type="Track", entity_id=track.id,
            new_state={"waiting": True, "has_lyrics": text is not None, "from_staff_console": True},
            organization_id=org,
        )
        approved = await approve_at_once(
            self.session, lambda: self.review(ctx, track_id, approve=True, note=None),
            ctx=ctx, act_id=track.primary_artist_id or track.primary_band_id, settings=self.settings,
        )
        if approved and timed is not None:
            track.lyrics_timings = timed
            track.updated_by = ctx.user_id
            await self.music._flush_versioned()
            await self._audit_timed(ctx, track)
        return await self.staff_read(ctx, track_id)
