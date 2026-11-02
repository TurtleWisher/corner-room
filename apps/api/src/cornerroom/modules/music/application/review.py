"""Release review, publication and takedown for Studio releases (AUDIO_PHASE_1_DESIGN 5.4, Phase 6).

A reviewer acts on a whole release and its tracks in one transaction: start review, approve,
request changes (with a note the artist sees), schedule, release, take down. Approving and
publishing need someone other than the people who prepared or own the release (two-person rule);
takedown needs music.takedown. Nothing becomes public without a verified, current audio version.
"""

from __future__ import annotations

from datetime import datetime
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
    RELEASE_CHANGES_REQUESTED,
    RELEASE_RELEASED,
    RELEASE_STAGE_CHANGED,
    TRACK_APPROVED,
    TRACK_RELEASED,
    TRACK_TAKEN_DOWN,
    DomainEvent,
)
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.music.application.service import MusicService
from cornerroom.modules.music.domain.models import Release, ReleaseReview, ReleaseTrack, Track

REVIEW_ACTIONS = frozenset({"start_review", "approve", "request_changes", "schedule", "release", "takedown"})


class ReviewService:
    def __init__(self, session: AsyncSession, settings: Settings | None = None, clock: Clock | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.clock = clock or SystemClock()
        self.music = MusicService(session, clock=self.clock, settings=self.settings)
        self.audit = AuditService(session)

    async def _tracks(self, release_id: UUID) -> list[Track]:
        rows = await self.session.execute(
            select(Track)
            .join(ReleaseTrack, ReleaseTrack.track_id == Track.id)
            .where(ReleaseTrack.release_id == release_id, Track.deleted_at.is_(None))
            .order_by(ReleaseTrack.position)
        )
        return list(rows.scalars().all())

    async def _require(self, ctx: AuthContext, release: Release, permission: str) -> None:
        if release.primary_org_id is None or not await self.music._is_allowed(
            ctx.user_id, permission, resource_type="release", resource_id=release.id, organization_id=release.primary_org_id
        ):
            # Existence hidden from anyone without review rights in this organization.
            if not await self.music._is_allowed(
                ctx.user_id, "music.approve", resource_type="release", resource_id=release.id, organization_id=release.primary_org_id
            ):
                raise NotFoundError("Release not found")
            raise AppError("FORBIDDEN", "Forbidden", 403, f"Missing permission {permission}")

    async def _event(self, ctx: AuthContext, event_type: str, agg: str, agg_id: UUID, payload: dict[str, Any], org: UUID | None) -> None:
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type, producer="music", aggregate_type=agg, aggregate_id=agg_id, payload=payload,
                occurred_at=self.clock.now(), actor_id=ctx.user_id, organization_id=org, correlation_id=ctx.request_id,
            ),
        )

    async def act(
        self,
        ctx: AuthContext,
        release_id: UUID,
        *,
        action: str,
        note: str | None = None,
        release_at: datetime | None = None,
        takedown_kind: str | None = None,
    ) -> Release:
        if action not in REVIEW_ACTIONS:
            raise AppError("VALIDATION_ERROR", "Unknown review action", 422)
        # D-AUDIO-14: an ordinary takedown keeps buyers' access; a legal/rights one removes it.
        kind = (takedown_kind or "STANDARD").upper()
        if action == "takedown" and kind not in {"STANDARD", "LEGAL"}:
            raise AppError("VALIDATION_ERROR", "Takedown kind must be STANDARD or LEGAL", 422)
        release = await self.music.get_release_row(release_id)
        await self._require(ctx, release, "music.takedown" if action == "takedown" else "music.approve")
        if release.primary_org_id is not None:
            await self.music._require_active_org(release.primary_org_id)
        if action in {"approve", "schedule", "release"}:
            await self.music.assert_independent_reviewer(ctx, [release.id])
        text = " ".join((note or "").split())[:2000] or None
        if action == "request_changes" and not text:
            raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
        tracks = await self._tracks(release.id)
        previous = release.status
        org = release.primary_org_id

        def move(track: Track, frm: set[str], to: str) -> bool:
            if track.status in frm:
                track.status = to
                track.updated_by = ctx.user_id
                return True
            return False

        if action == "start_review":
            if release.status != "METADATA_REVIEW":
                raise AppError("INVALID_TRANSITION", "Only a submitted release can be reviewed", 409)
            for t in tracks:
                move(t, {"SUBMITTED"}, "IN_REVIEW")
        elif action == "request_changes":
            if release.status not in {"METADATA_REVIEW", "APPROVED", "SCHEDULED"}:
                raise AppError("INVALID_TRANSITION", "Changes can be requested only before release", 409)
            release.status = "IN_PRODUCTION"
            for t in tracks:
                move(t, {"SUBMITTED", "IN_REVIEW", "APPROVED", "SCHEDULED"}, "DRAFT")
        elif action == "approve":
            if release.status != "METADATA_REVIEW":
                raise AppError("INVALID_TRANSITION", "Only a release in review can be approved", 409)
            if any(t.status not in {"IN_REVIEW", "APPROVED"} for t in tracks) or not tracks:
                raise AppError("INVALID_TRANSITION", "Start the review of every track first", 409)
            for t in tracks:
                if await self.music._current_ready_version(t.id) is None:
                    raise AppError("VERSION_NOT_READY", f"“{t.title}” has no verified audio", 409)
            release.status = "APPROVED"
            for t in tracks:
                if move(t, {"IN_REVIEW"}, "APPROVED"):
                    await self._event(ctx, TRACK_APPROVED, "Track", t.id, {"status": "APPROVED", "previous_status": "IN_REVIEW"}, org)
        elif action == "schedule":
            # A scheduled release can move to a new date (D-PRESALE-02: pre-order buyers are told).
            if release.status not in {"APPROVED", "SCHEDULED"}:
                raise AppError("INVALID_TRANSITION", "Approve the release before scheduling it", 409)
            # An early pre-sale (D-PRESALE-03) already told fans a date: moving it tells buyers too.
            moved_from = release.release_at if release.status == "SCHEDULED" or release.presale_status == "APPROVED" else None
            if release_at is None or release_at <= self.clock.now():
                raise AppError("VALIDATION_ERROR", "Choose a release date in the future", 422)
            release.status = "SCHEDULED"
            release.release_at = release_at
            for t in tracks:
                move(t, {"APPROVED"}, "SCHEDULED")
        elif action == "release":
            if release.status not in {"APPROVED", "SCHEDULED"}:
                raise AppError("INVALID_TRANSITION", "Approve the release first", 409)
            for t in tracks:
                if await self.music._current_ready_version(t.id) is None:
                    raise AppError("VERSION_NOT_READY", f"“{t.title}” has no verified audio", 409)
            release.status = "RELEASED"
            if release.release_at is None:
                release.release_at = self.clock.now()
            for t in tracks:
                prev = t.status
                if move(t, {"APPROVED", "SCHEDULED"}, "RELEASED"):
                    await self._event(ctx, TRACK_RELEASED, "Track", t.id, {"status": "RELEASED", "previous_status": prev}, org)
        elif action == "takedown":
            if release.status not in {"APPROVED", "SCHEDULED", "RELEASED"}:
                raise AppError("INVALID_TRANSITION", "Only an approved or released release can be taken down", 409)
            release.status = "TAKEN_DOWN"
            release.takedown_kind = kind
            for t in tracks:
                prev = t.status
                if move(t, {"APPROVED", "SCHEDULED", "RELEASED"}, "TAKEN_DOWN"):
                    t.takedown_kind = kind
                    await self._event(
                        ctx, TRACK_TAKEN_DOWN, "Track", t.id,
                        {"status": "TAKEN_DOWN", "previous_status": prev, "takedown_kind": kind}, org,
                    )
        release.updated_by = ctx.user_id
        await self.music._flush_versioned()
        self.session.add(
            ReleaseReview(release_id=release.id, reviewer_id=ctx.user_id, action=action, note=text, from_status=previous, to_status=release.status)
        )
        await self.session.flush()
        if action == "schedule" and moved_from is not None and moved_from != release.release_at:
            from cornerroom.kernel.events import PRESALE_DATE_CHANGED
            from cornerroom.modules.commerce.application.onsite_presale import PresaleService

            await PresaleService(self.session, self.settings, self.clock).tell_buyers(release, PRESALE_DATE_CHANGED, actor=ctx.user_id)
        if action == "release":
            from cornerroom.modules.commerce.application.onsite_presale import PresaleService

            await PresaleService(self.session, self.settings, self.clock).after_release(release, actor=ctx.user_id)
            event_type = RELEASE_RELEASED
        elif action == "request_changes":
            event_type = RELEASE_CHANGES_REQUESTED
        else:
            event_type = RELEASE_STAGE_CHANGED
        await self._event(
            ctx, event_type, "Release", release.id,
            {"status": release.status, "previous_status": previous, "release_type": release.release_type, "review_action": action},
            org,
        )
        await self.audit.record_from_auth(
            ctx, action=f"release.review.{action}", entity_type="Release", entity_id=release.id,
            previous_state={"status": previous},
            new_state={"status": release.status, "note": text, **({"takedown_kind": kind} if action == "takedown" else {})},
            organization_id=org,
        )
        return release

    # --- early pre-sale (D-PRESALE-03) ---------------------------------------------------------

    async def presale_decision(
        self, ctx: AuthContext, release_id: UUID, *, decision: str, release_at: datetime | None = None, note: str | None = None
    ) -> Release:
        """Staff decide an early pre-sale: approve its title, artist, date and price going public
        (the release itself is still reviewed in full later), send it back with a note, or move an
        approved pre-sale's date (buyers are emailed). Same reviewers and two-person rule as a release."""
        from cornerroom.kernel.events import PRESALE_DATE_CHANGED
        from cornerroom.modules.commerce.application.onsite_presale import BEFORE_RELEASE_STATUSES, PresaleService

        if decision not in {"approve", "return", "move_date"}:
            raise AppError("VALIDATION_ERROR", "Decision must be approve, return or move_date", 422)
        release = await self.music.get_release_row(release_id)
        await self._require(ctx, release, "music.approve")
        if release.primary_org_id is not None:
            await self.music._require_active_org(release.primary_org_id)
        if release.status not in BEFORE_RELEASE_STATUSES:
            raise AppError("INVALID_TRANSITION", "This release's date is set by scheduling it now", 409)
        text = " ".join((note or "").split())[:2000] or None
        now = self.clock.now()
        previous = release.presale_status
        moved_from = release.release_at
        if decision == "approve":
            if release.presale_status != "REQUESTED":
                raise AppError("INVALID_TRANSITION", "This pre-sale isn't waiting for review", 409)
            await self.music.assert_independent_reviewer(ctx, [release.id])
            when = release_at or release.presale_requested_release_at
            if when is None or when <= now:
                raise AppError("VALIDATION_ERROR", "Choose a release date in the future", 422)
            release.presale_status = "APPROVED"
            release.release_at = when
            release.presale_note = text
        elif decision == "return":
            if release.presale_status != "REQUESTED":
                raise AppError("INVALID_TRANSITION", "This pre-sale isn't waiting for review", 409)
            if not text:
                raise AppError("VALIDATION_ERROR", "Tell the artist what to change", 422)
            release.presale_status = "RETURNED"
            release.presale_note = text
        else:
            if release.presale_status != "APPROVED":
                raise AppError("INVALID_TRANSITION", "Only an approved pre-sale has a date to move", 409)
            await self.music.assert_independent_reviewer(ctx, [release.id])
            if release_at is None or release_at <= now:
                raise AppError("VALIDATION_ERROR", "Choose a release date in the future", 422)
            release.release_at = release_at
        release.presale_decided_by = ctx.user_id
        release.presale_decided_at = now
        release.updated_by = ctx.user_id
        await self.music._flush_versioned()
        action = {"approve": "approve_presale", "return": "return_presale", "move_date": "move_presale_date"}[decision]
        self.session.add(
            ReleaseReview(release_id=release.id, reviewer_id=ctx.user_id, action=action, note=text, from_status=release.status, to_status=release.status)
        )
        await self.session.flush()
        if decision == "move_date" and moved_from != release.release_at:
            await PresaleService(self.session, self.settings, self.clock).tell_buyers(release, PRESALE_DATE_CHANGED, actor=ctx.user_id)
        await self.audit.record_from_auth(
            ctx, action=f"release.presale.{decision}", entity_type="Release", entity_id=release.id,
            previous_state={"presale_status": previous, "release_at": moved_from.isoformat() if moved_from else None},
            new_state={"presale_status": release.presale_status, "release_at": release.release_at.isoformat() if release.release_at else None, "note": text},
            organization_id=release.primary_org_id,
        )
        return release

    async def system_release(self, release: Release, *, actor: UUID) -> bool:
        """The scheduler releases music whose date has come (owner, 2026-10-28, D-PRESALE-02), the
        same way as "Release now": every song needs verified audio, else it waits for staff."""
        if release.status != "SCHEDULED":
            return False
        tracks = await self._tracks(release.id)
        for t in tracks:
            if await self.music._current_ready_version(t.id) is None:
                return False
        org = release.primary_org_id
        release.status = "RELEASED"
        for t in tracks:
            if t.status in {"APPROVED", "SCHEDULED"}:
                prev = t.status
                t.status = "RELEASED"
                await self._system_event(TRACK_RELEASED, "Track", t.id, {"status": "RELEASED", "previous_status": prev}, org)
        await self.music._flush_versioned()
        self.session.add(
            ReleaseReview(release_id=release.id, reviewer_id=actor, action="release", note="Released on its scheduled date",
                          from_status="SCHEDULED", to_status="RELEASED")
        )
        await self.session.flush()
        await self._system_event(
            RELEASE_RELEASED, "Release", release.id,
            {"status": "RELEASED", "previous_status": "SCHEDULED", "release_type": release.release_type, "review_action": "release"}, org,
        )
        await self.audit.record(
            action="release.review.release", entity_type="Release", entity_id=release.id,
            actor_id="system:scheduler", actor_type="system",
            previous_state={"status": "SCHEDULED"}, new_state={"status": "RELEASED"},
        )
        return True

    async def _system_event(self, event_type: str, agg: str, agg_id: UUID, payload: dict[str, Any], org: UUID | None) -> None:
        await enqueue_outbox(
            self.session,
            DomainEvent(
                event_type=event_type, producer="music", aggregate_type=agg, aggregate_id=agg_id, payload=payload,
                occurred_at=self.clock.now(), actor_id=None, organization_id=org,
            ),
        )

    async def history(self, release_id: UUID) -> list[dict[str, Any]]:
        rows = (
            await self.session.execute(
                select(ReleaseReview).where(ReleaseReview.release_id == release_id).order_by(ReleaseReview.created_at.desc())
            )
        ).scalars().all()
        return [
            {"action": r.action, "note": r.note, "from_status": r.from_status, "to_status": r.to_status, "created_at": r.created_at}
            for r in rows
        ]
