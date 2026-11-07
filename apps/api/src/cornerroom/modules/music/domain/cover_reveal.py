"""Whether fans see a pre-sale's cover clearly before release (owner, 2026-11-07, D-COVER-03,
replacing the timed reveal of D-COVER-02).

The artist has one on/off switch in the pre-sale. Off: fans see the cover lightly blurred (or the
title screen lightly blurred when there is no cover). On: the cover as it is (or the title screen,
sharp). It can be switched back off any time before release; after release the cover is public
anyway. Pure rules; the Studio service checks who may switch it.

`cover_revealed_at` is the switch (set: on). Releases that chose a lead time under D-COVER-02 keep
it: their cover counts as on from that moment, and switching off clears it.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

# Before release the switch can be used; after it the cover is public anyway.
REVEAL_SETTABLE_STATUSES = frozenset({"IDEA", "DEMO", "IN_PRODUCTION", "QC", "METADATA_REVIEW", "APPROVED", "SCHEDULED"})


def reveal_at(release: Any) -> datetime | None:
    """The moment the cover counts as shown, or None while the switch is off."""
    if release.cover_revealed_at is not None:
        return release.cover_revealed_at
    if release.cover_reveal_lead_minutes is None or release.release_at is None:
        return None
    return release.release_at - timedelta(minutes=release.cover_reveal_lead_minutes)


def cover_revealed(release: Any, now: datetime) -> bool:
    """Whether the switch is on now: fans see the cover clearly ahead of release."""
    moment = reveal_at(release)
    return moment is not None and moment <= now
