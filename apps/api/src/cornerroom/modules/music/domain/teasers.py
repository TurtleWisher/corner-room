"""Teaser rules (owner, 2026-11-07, D-TEASER-00 to D-TEASER-04). Pure: no database, no clock.

A teaser is the free, permanent way to hear a song for everyone who has not bought it. It is cut from
the song's own master by edit settings (start, end, fades, gain) and never changes the master. Each set
of settings is a version; staff approve a version before the public hears it (D-TEASER-01), and a
newer version waits while the approved one stays live.
"""

from __future__ import annotations

from dataclasses import dataclass

# Teaser (the public identity).
DRAFT = "DRAFT"  # never public, nothing waiting
IN_REVIEW = "IN_REVIEW"  # never public, a version waits for staff
PUBLISHED = "PUBLISHED"  # the live version is public
UNPUBLISHED = "UNPUBLISHED"  # was public, taken off by the artist or staff; can go back up
TEASER_STATUSES = (DRAFT, IN_REVIEW, PUBLISHED, UNPUBLISHED)

# Version processing.
V_DRAFT = "DRAFT"
V_PROCESSING = "PROCESSING"
V_READY = "READY"
V_FAILED = "FAILED"

# Version review.
WAITING = "WAITING"
APPROVED = "APPROVED"
RETURNED = "RETURNED"
WITHDRAWN = "WITHDRAWN"

# Tool limits (Q-TS-16, Q-TS-17): not product rules; the player still levels loudness (D-AUDIO-08).
GAIN_MIN_CDB = -1200
GAIN_MAX_CDB = 600
FADE_MAX_MS = 10_000

# Bump when the FFmpeg recipe changes, so new jobs get new keys and old files stay traceable.
PROCESSING_VERSION = 1


@dataclass(frozen=True, slots=True)
class Settings:
    start_ms: int
    end_ms: int
    fade_in_ms: int = 0
    fade_out_ms: int = 0
    gain_cdb: int = 0

    @property
    def length_ms(self) -> int:
        return self.end_ms - self.start_ms


def problems(s: Settings, *, master_ms: int, min_ms: int, max_ms: int) -> list[str]:
    """Every reason these settings can't be cut, as stable codes (empty list: fine)."""
    out: list[str] = []
    if s.start_ms < 0:
        out.append("START_BEFORE_SONG")
    if s.end_ms > master_ms:
        out.append("END_AFTER_SONG")
    if s.end_ms <= s.start_ms:
        out.append("END_BEFORE_START")
        return out
    if s.length_ms < min_ms:
        out.append("TOO_SHORT")
    if max_ms <= 0 or s.length_ms > max_ms:
        # max 0 = not configured: fail closed, nothing can be made.
        out.append("TOO_LONG")
    for value in (s.fade_in_ms, s.fade_out_ms):
        if value < 0 or value > FADE_MAX_MS or value * 2 > s.length_ms:
            out.append("FADE_TOO_LONG")
            break
    if not GAIN_MIN_CDB <= s.gain_cdb <= GAIN_MAX_CDB:
        out.append("GAIN_OUT_OF_RANGE")
    return out


def default_settings(master_ms: int, *, max_ms: int) -> Settings:
    """A first cut the artist then moves: from the start of the song, as long as allowed."""
    length = min(master_ms, max_ms) if max_ms > 0 else master_ms
    return Settings(start_ms=0, end_ms=max(1, length))


@dataclass(frozen=True, slots=True)
class VersionFacts:
    status: str
    review_status: str | None
    is_live: bool


def status_after(*, has_live: bool, live_shown: bool, waiting: bool) -> str:
    """The teaser's status from its versions: public if a live version is shown, otherwise in review
    if the first version waits, otherwise a draft (never public) or unpublished (was public)."""
    if has_live:
        return PUBLISHED if live_shown else UNPUBLISHED
    return IN_REVIEW if waiting else DRAFT


def artist_actions(status: str, latest: VersionFacts | None, *, ever_published: bool) -> list[str]:
    """What the artist may do now. The page shows these; it never decides them itself."""
    out: list[str] = []
    if latest is not None and not latest.is_live:
        if latest.status in (V_DRAFT, V_FAILED) and latest.review_status != WAITING:
            out.append("process")
        if latest.status == V_READY and latest.review_status in (None, RETURNED, WITHDRAWN):
            out.append("submit")
        if latest.review_status == WAITING:
            out.append("withdraw")
    if status == PUBLISHED:
        out.append("unpublish")
    if status == UNPUBLISHED:
        out.append("republish")
    if not ever_published and (latest is None or latest.review_status != WAITING):
        out.append("delete")
    return out


def public(*, teaser_status: str, teaser_deleted: bool, live_ready: bool, track_status: str | None,
           track_deleted: bool) -> bool:
    """A teaser is public only when it is published, its live copy is made, and its song still
    exists and isn't taken down (Q-TS-10, fail closed)."""
    return (
        teaser_status == PUBLISHED
        and not teaser_deleted
        and live_ready
        and track_status is not None
        and track_status != "TAKEN_DOWN"
        and not track_deleted
    )
