"""When fans may see a release's cover before it is out (owner, 2026-11-02, D-COVER-02).

By default the cover stays hidden until release, like the songs. The artist may instead show it
early: a set time before release (for example 2 hours or 3 days), or at once with "Reveal now".
Once shown it stays shown. Pure rules; the Studio service checks who may change them.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

# Bounds on the early-reveal lead: from 1 hour to 30 days before release.
MIN_LEAD_MINUTES = 60
MAX_LEAD_MINUTES = 30 * 24 * 60
# Before release the reveal can still be set; after it the cover is public anyway.
REVEAL_SETTABLE_STATUSES = frozenset({"IDEA", "DEMO", "IN_PRODUCTION", "QC", "METADATA_REVIEW", "APPROVED", "SCHEDULED"})


def reveal_at(release: Any) -> datetime | None:
    """The moment the cover shows, or None when it waits for release (or the date isn't set)."""
    if release.cover_revealed_at is not None:
        return release.cover_revealed_at
    if release.cover_reveal_lead_minutes is None or release.release_at is None:
        return None
    return release.release_at - timedelta(minutes=release.cover_reveal_lead_minutes)


def cover_revealed(release: Any, now: datetime) -> bool:
    """Whether fans may see the cover now, ahead of release."""
    moment = reveal_at(release)
    return moment is not None and moment <= now


def lead_is_valid(minutes: int) -> bool:
    return MIN_LEAD_MINUTES <= minutes <= MAX_LEAD_MINUTES
