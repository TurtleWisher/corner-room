"""Changes to released music, reviewed by staff (owner, 2026-10-28, D-CHANGES-01).

Once a release is approved, scheduled or out, its details, its songs' details and credits, and
its audio can still change, but nothing reaches listeners until staff approve. The artist (or
staff helping them) edits as usual in Studio; each edit is checked with the same rules as a
draft and held in the release's one open change request. A replacement audio file is processed
like any upload but stays off the air. The artist sends the request for review; staff see every
change old next to new and approve it (everything is applied in one transaction) or send it back
with a note. Whoever prepared or owns the release, or sent the request, can't approve it (the
release two-person rule). Lyrics (D-LYRICS-01) and covers (D-COVER-01) keep their own reviews.
"""

from __future__ import annotations

import copy
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ConflictError, NotFoundError
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    METADATA_CORRECTED,
    RELEASE_CHANGES_REJECTED,
    RELEASE_CHANGES_SUBMITTED,
)
from cornerroom.modules.music.application.studio import StudioService
from cornerroom.modules.music.domain.models import (
    Credit,
    Release,
    ReleaseChangeRequest,
    ReleaseTrack,
    Track,
    TrackVersion,
)

REVIEWED_RELEASE_STATUSES = frozenset({"APPROVED", "SCHEDULED", "RELEASED"})
LIVE_REQUEST_STATUSES = ("OPEN", "SUBMITTED")
RELEASE_FIELDS = ("title", "language_code", "genre_primary", "genre_secondary", "label_name", "p_line", "c_line", "upc")
TRACK_FIELDS = ("title", "version_title", "explicit", "language_code", "genre_primary", "genre_secondary", "isrc")
FIELD_LABELS = {
    "title": "Title",
    "version_title": "Version",
    "explicit": "Explicit",
    "language_code": "Language",
    "genre_primary": "Main genre",
    "genre_secondary": "Second genre",
    "label_name": "Label",
    "p_line": "P line",
    "c_line": "C line",
    "upc": "UPC",
    "isrc": "ISRC",
}


def _text(value: Any) -> str:
    if value is None or value == "":
        return "None"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)


def credit_line(c: dict[str, Any], names: dict[str, str]) -> str:
    """One credit in words, as the song page says it (owner, 2026-10-31): a role the artist named
    reads "Songwriter & Composer: MIZULS", a musician "Guitars: Rafi", never "Custom: ..."."""
    who = (names.get(str(c.get("artist_id"))) if c.get("artist_id") else c.get("display_name")) or "Not available"
    role = (c.get("role_key") or "").lower()
    instrument = (c.get("instrument") or "").strip()
    if role == "custom":
        return f"{instrument or 'Credit'}: {who}"
    if role == "musician":
        return f"{instrument or 'Musician'}: {who}"
    line = f"{role.replace('_', ' ').capitalize()}: {who}"
    return f"{line} ({instrument})" if instrument else line


class ChangeRequestService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.studio = StudioService(session, self.settings, self.clock)
        self.music = self.studio.music
        self.audit = self.studio.audit

    # --- reading ---------------------------------------------------------------------------

    async def live_request(self, release_id: UUID) -> ReleaseChangeRequest | None:
        return (
            await self.session.execute(
                select(ReleaseChangeRequest).where(
                    ReleaseChangeRequest.release_id == release_id, ReleaseChangeRequest.status.in_(LIVE_REQUEST_STATUSES)
                )
            )
        ).scalar_one_or_none()

    async def last_decision(self, release_id: UUID) -> ReleaseChangeRequest | None:
        return (
            await self.session.execute(
                select(ReleaseChangeRequest)
                .where(ReleaseChangeRequest.release_id == release_id, ReleaseChangeRequest.status.in_(("APPROVED", "REJECTED")))
                .order_by(ReleaseChangeRequest.decided_at.desc().nulls_last())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def _current_credits(self, track_id: UUID) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                select(Credit).where(Credit.track_id == track_id, Credit.deleted_at.is_(None)).order_by(Credit.position, Credit.created_at)
            )
        ).scalars().all()
        return [
            {
                "role_key": c.role_key or c.credit_role,
                "artist_id": str(c.artist_id) if c.artist_id else None,
                "display_name": c.display_name,
                "instrument": c.instrument,
            }
            for c in rows
        ]

    async def view(self, req: ReleaseChangeRequest, release: Release) -> dict[str, Any]:
        """The request with every change old next to new, for Studio and for staff."""
        from cornerroom.modules.artists.domain.models import Artist

        changes = req.changes or {}
        diff: list[dict[str, Any]] = []
        for key, after in (changes.get("release") or {}).items():
            diff.append({"scope": "Release", "field": FIELD_LABELS.get(key, key), "before": _text(getattr(release, key)), "after": _text(after)})
        positions = {t.id: pos for pos, t in await self.studio._tracks_of(release.id)}
        artist_ids = {
            c["artist_id"]
            for t in (changes.get("tracks") or {}).values()
            for c in (t.get("credits") or [])
            if c.get("artist_id")
        }
        audio: list[dict[str, Any]] = []
        for tid, t in (changes.get("tracks") or {}).items():
            track = await self.session.get(Track, UUID(tid))
            if track is None:
                continue
            scope = f"Song {positions.get(track.id, '')}: {track.title}".replace("Song : ", "Song: ")
            for key, after in (t.get("fields") or {}).items():
                diff.append({"scope": scope, "field": FIELD_LABELS.get(key, key), "before": _text(getattr(track, key)), "after": _text(after)})
            if t.get("credits") is not None:
                before = await self._current_credits(track.id)
                artist_ids |= {c["artist_id"] for c in before if c.get("artist_id")}
                names = {
                    str(a.id): a.stage_name
                    for a in (
                        await self.session.execute(select(Artist).where(Artist.id.in_([UUID(x) for x in artist_ids] or [UUID(int=0)])))
                    ).scalars()
                }
                diff.append({
                    "scope": scope,
                    "field": "Credits",
                    "before": "; ".join(credit_line(c, names) for c in before) or "None",
                    "after": "; ".join(credit_line(c, names) for c in t["credits"]) or "None",
                })
            if t.get("audio_version_id"):
                version = await self.session.get(TrackVersion, UUID(t["audio_version_id"]))
                status = version.status if version is not None else "MISSING"
                diff.append({
                    "scope": scope,
                    "field": "Audio file",
                    "before": "The current audio",
                    "after": {"READY": "New audio, checked and ready", "PROCESSING": "New audio, still being checked",
                              "UPLOADING": "New audio, still uploading", "REJECTED": "New audio failed the checks"}.get(status, "New audio"),
                })
                audio.append({
                    "track_id": track.id,
                    "version_id": UUID(t["audio_version_id"]),
                    "status": status,
                    "duration_ms": version.duration_ms if version is not None else None,
                })
        kind, pid = self.music.profile_of(release)
        profile_name = None
        if kind is not None and pid is not None:
            _row, _org, profile_name = await self.studio._profile(kind, pid)
        return {
            "id": req.id,
            "release_id": release.id,
            "release_title": release.title,
            "profile_name": profile_name,
            "status": req.status,
            "submitted_at": req.submitted_at,
            "decided_at": req.decided_at,
            "review_note": req.review_note,
            "changes": changes,
            "diff": diff,
            "audio": audio,
        }

    # --- editing (Studio) --------------------------------------------------------------------

    async def _editable(self, ctx: AuthContext, release_id: UUID) -> tuple[ReleaseChangeRequest, Release, str]:
        release, role = await self.studio._release(ctx, release_id)
        if release.status not in REVIEWED_RELEASE_STATUSES:
            raise AppError("INVALID_TRANSITION", "Edit this release directly", 409, "Only approved or released music takes a change request")
        req = await self.live_request(release.id)
        if req is None:
            req = ReleaseChangeRequest(release_id=release.id, status="OPEN", changes={}, created_by=ctx.user_id)
            self.session.add(req)
            try:
                await self.session.flush()
            except IntegrityError as exc:
                raise ConflictError("Someone else just started changes to this release. Reload.") from exc
        elif req.status == "SUBMITTED":
            # Editing a sent request takes it back from review until it is sent again.
            req.status = "OPEN"
            req.submitted_at = None
            req.submitted_by = None
        return req, release, role

    async def _for_track(self, ctx: AuthContext, track_id: UUID) -> tuple[ReleaseChangeRequest, Release, Track, str]:
        track, release, _role = await self.studio._track(ctx, track_id)
        req, release, role = await self._editable(ctx, release.id)
        return req, release, track, role

    async def _save(self, ctx: AuthContext, req: ReleaseChangeRequest, release: Release, role: str, changes: dict[str, Any], what: str) -> None:
        req.changes = changes  # a new object, so the JSON change is saved
        await self.music._flush_versioned()
        await self.studio._note_staff(ctx, release, role)
        await self.audit.record_from_auth(
            ctx, action="release.change_edited", entity_type="Release", entity_id=release.id,
            new_state={"request_id": str(req.id), "what": what}, organization_id=release.primary_org_id,
        )

    async def start(self, ctx: AuthContext, release_id: UUID) -> dict[str, Any]:
        req, release, _role = await self._editable(ctx, release_id)
        return await self.view(req, release)

    async def save_release_fields(self, ctx: AuthContext, release_id: UUID, fields: dict[str, Any]) -> dict[str, Any]:
        req, release, role = await self._editable(ctx, release_id)
        cleaned = await self.studio.clean_release_fields({k: v for k, v in fields.items() if k in RELEASE_FIELDS})
        changes = copy.deepcopy(req.changes or {})
        rel = changes.setdefault("release", {})
        for key, value in cleaned.items():
            if value == getattr(release, key):
                rel.pop(key, None)
            else:
                rel[key] = value
        primary = rel.get("genre_primary", release.genre_primary)
        secondary = rel.get("genre_secondary", release.genre_secondary)
        if secondary and secondary == primary:
            raise AppError("VALIDATION_ERROR", "The second genre must differ from the main genre", 422)
        if not rel:
            changes.pop("release", None)
        await self._save(ctx, req, release, role, changes, "release")
        return await self.view(req, release)

    def _track_entry(self, changes: dict[str, Any], track_id: UUID) -> dict[str, Any]:
        return changes.setdefault("tracks", {}).setdefault(str(track_id), {})

    @staticmethod
    def _tidy(changes: dict[str, Any], track_id: UUID) -> None:
        tracks = changes.get("tracks") or {}
        entry = tracks.get(str(track_id))
        if entry is not None and not any(entry.get(k) not in (None, {}) for k in ("fields", "credits", "audio_version_id")):
            tracks.pop(str(track_id), None)
        if not tracks:
            changes.pop("tracks", None)

    async def save_track_fields(self, ctx: AuthContext, track_id: UUID, fields: dict[str, Any]) -> dict[str, Any]:
        req, release, track, role = await self._for_track(ctx, track_id)
        cleaned = await self.studio.clean_track_fields({k: v for k, v in fields.items() if k in TRACK_FIELDS})
        changes = copy.deepcopy(req.changes or {})
        entry = self._track_entry(changes, track.id)
        stored = entry.setdefault("fields", {})
        for key, value in cleaned.items():
            if value == getattr(track, key):
                stored.pop(key, None)
            else:
                stored[key] = value
        if not stored:
            entry.pop("fields", None)
        self._tidy(changes, track.id)
        await self._save(ctx, req, release, role, changes, "track")
        return await self.view(req, release)

    async def save_track_credits(self, ctx: AuthContext, track_id: UUID, credits: list[dict[str, Any]]) -> dict[str, Any]:
        req, release, track, role = await self._for_track(ctx, track_id)
        cleaned = await self.studio.clean_credits(credits)
        changes = copy.deepcopy(req.changes or {})
        entry = self._track_entry(changes, track.id)
        if cleaned == await self._current_credits(track.id):
            entry.pop("credits", None)
        else:
            entry["credits"] = cleaned
        self._tidy(changes, track.id)
        await self._save(ctx, req, release, role, changes, "credits")
        return await self.view(req, release)

    async def attach_audio(self, ctx: AuthContext, track_id: UUID, version: TrackVersion) -> None:
        """A replacement audio file for released music: held in the change request (Studio calls
        this right after creating the version). An earlier waiting replacement is dropped."""
        req, release, track, role = await self._for_track(ctx, track_id)
        changes = copy.deepcopy(req.changes or {})
        entry = self._track_entry(changes, track.id)
        await self._drop_audio(entry.get("audio_version_id"))
        entry["audio_version_id"] = str(version.id)
        await self._save(ctx, req, release, role, changes, "audio")

    async def _drop_audio(self, version_id: str | None) -> None:
        if not version_id:
            return
        version = await self.session.get(TrackVersion, UUID(version_id))
        if version is not None and not version.is_current and version.deleted_at is None:
            version.deleted_at = self.clock.now()
            await self.session.flush()

    async def _drop_all_audio(self, req: ReleaseChangeRequest) -> None:
        for entry in ((req.changes or {}).get("tracks") or {}).values():
            await self._drop_audio(entry.get("audio_version_id"))

    async def submit(self, ctx: AuthContext, release_id: UUID) -> dict[str, Any]:
        release, _role = await self.studio._release(ctx, release_id)
        req = await self.live_request(release.id)
        if req is None or req.status != "OPEN" or not (req.changes or {}):
            raise AppError("INVALID_TRANSITION", "There are no changes to send", 409)
        for entry in ((req.changes or {}).get("tracks") or {}).values():
            if entry.get("audio_version_id"):
                version = await self.session.get(TrackVersion, UUID(entry["audio_version_id"]))
                if version is None or version.status != "READY":
                    raise AppError("VERSION_NOT_READY", "Wait until the new audio has passed its checks", 409)
        req.status = "SUBMITTED"
        req.submitted_at = self.clock.now()
        req.submitted_by = ctx.user_id
        req.review_note = None
        await self.music._flush_versioned()
        await self.studio._event(RELEASE_CHANGES_SUBMITTED, "Release", release.id, {"request_id": str(req.id)}, ctx, release.primary_org_id)
        await self.audit.record_from_auth(
            ctx, action="release.changes_submitted", entity_type="Release", entity_id=release.id,
            new_state={"request_id": str(req.id)}, organization_id=release.primary_org_id,
        )
        return await self.view(req, release)

    async def withdraw(self, ctx: AuthContext, release_id: UUID) -> None:
        release, _role = await self.studio._release(ctx, release_id)
        req = await self.live_request(release.id)
        if req is None:
            return
        await self._drop_all_audio(req)
        req.status = "WITHDRAWN"
        await self.music._flush_versioned()
        await self.audit.record_from_auth(
            ctx, action="release.changes_withdrawn", entity_type="Release", entity_id=release.id,
            new_state={"request_id": str(req.id)}, organization_id=release.primary_org_id,
        )

    # --- staff review --------------------------------------------------------------------------

    async def queue(self, ctx: AuthContext) -> list[dict[str, Any]]:
        org = await self.studio._require_staff_workspace(ctx, "music.approve")
        rows = (
            await self.session.execute(
                select(ReleaseChangeRequest, Release)
                .join(Release, Release.id == ReleaseChangeRequest.release_id)
                .where(ReleaseChangeRequest.status == "SUBMITTED", Release.primary_org_id == org, Release.deleted_at.is_(None))
                .order_by(ReleaseChangeRequest.submitted_at)
                .limit(200)
            )
        ).all()
        return [await self.view(req, release) for req, release in rows]

    async def _reviewable(self, ctx: AuthContext, release_id: UUID) -> Release:
        release = await self.music.get_release_row(release_id)
        if release.primary_org_id is None or not await self.music._is_allowed(
            ctx.user_id, "music.approve", resource_type="release", resource_id=release.id, organization_id=release.primary_org_id
        ):
            raise NotFoundError("Release not found")
        return release

    async def staff_view(self, ctx: AuthContext, release_id: UUID) -> dict[str, Any] | None:
        release = await self._reviewable(ctx, release_id)
        req = await self.live_request(release.id)
        return await self.view(req, release) if req is not None and req.status == "SUBMITTED" else None

    async def review(self, ctx: AuthContext, release_id: UUID, *, approve: bool, note: str | None) -> dict[str, Any]:
        release = await self._reviewable(ctx, release_id)
        req = await self.live_request(release.id)
        if req is None or req.status != "SUBMITTED":
            raise AppError("INVALID_TRANSITION", "No changes are waiting for this release", 409)
        text = " ".join((note or "").split())[:2000] or None
        if approve:
            await self.music.assert_independent_reviewer(ctx, [release.id])
            if ctx.user_id in {req.submitted_by, req.created_by}:
                raise AppError("SAME_PERSON_REVIEW", "Someone else must approve this", 403, "You made these changes")
            await self._apply(req, release, ctx.user_id)
            req.status = "APPROVED"
        else:
            if not text:
                raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
            await self._drop_all_audio(req)
            req.status = "REJECTED"
        req.review_note = text
        req.decided_by = ctx.user_id
        req.decided_at = self.clock.now()
        await self.music._flush_versioned()
        await self.studio._event(
            METADATA_CORRECTED if approve else RELEASE_CHANGES_REJECTED, "Release", release.id, {"request_id": str(req.id)}, ctx,
            release.primary_org_id,
        )
        if approve:
            # Search and other readers refresh each changed song too.
            for tid in ((req.changes or {}).get("tracks") or {}):
                await self.studio._event(METADATA_CORRECTED, "Track", UUID(tid), {"request_id": str(req.id)}, ctx, release.primary_org_id)
        await self.audit.record_from_auth(
            ctx, action="release.changes_approved" if approve else "release.changes_rejected", entity_type="Release",
            entity_id=release.id, new_state={"request_id": str(req.id), "note": text}, organization_id=release.primary_org_id,
        )
        return await self.view(req, release)

    async def _apply(self, req: ReleaseChangeRequest, release: Release, actor: UUID) -> None:
        """Everything in the request goes public at once; checked again first."""
        changes = req.changes or {}
        for key, value in (await self.studio.clean_release_fields(changes.get("release") or {})).items():
            setattr(release, key, value)
        if release.genre_secondary and release.genre_secondary == release.genre_primary:
            raise AppError("VALIDATION_ERROR", "The second genre must differ from the main genre", 422)
        release.updated_by = actor
        on_release = set(
            (await self.session.execute(select(ReleaseTrack.track_id).where(ReleaseTrack.release_id == release.id))).scalars()
        )
        for tid, entry in (changes.get("tracks") or {}).items():
            track = await self.session.get(Track, UUID(tid))
            if track is None or track.deleted_at is not None or track.id not in on_release:
                continue
            for key, value in (await self.studio.clean_track_fields(entry.get("fields") or {})).items():
                setattr(track, key, value)
            track.updated_by = actor
            if entry.get("credits") is not None:
                await self.studio.replace_credits(track, await self.studio.clean_credits(entry["credits"]), actor)
            if entry.get("audio_version_id"):
                await self._swap_audio(track, UUID(entry["audio_version_id"]))
        try:
            await self.music._flush_versioned()
        except ConflictError as exc:
            raise ConflictError("An ISRC or UPC in these changes is already used elsewhere") from exc

    async def _swap_audio(self, track: Track, version_id: UUID) -> None:
        version = await self.session.get(TrackVersion, version_id)
        if version is None or version.track_id != track.id or version.deleted_at is not None or version.status != "READY":
            raise AppError("VERSION_NOT_READY", f"The new audio for “{track.title}” isn't ready", 409)
        if version.is_current:
            return
        current = (
            await self.session.execute(
                select(TrackVersion).where(
                    TrackVersion.track_id == track.id, TrackVersion.is_current.is_(True), TrackVersion.deleted_at.is_(None)
                )
            )
        ).scalar_one_or_none()
        if current is not None:
            current.is_current = False
            if current.status == "READY":
                current.status = "SUPERSEDED"
            await self.session.flush()
        version.is_current = True
        await self.session.flush()
