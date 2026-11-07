"""Who has to approve what, while Corner Room has one staff member (owner, 2026-11-07, D-REVIEW-SOLO-01).

The owner runs Corner Room alone for now, so the rule "someone else must approve this" (the release
two-person rule, D-AUDIO-09, and the same-person checks built on it) can't be met by anyone. While
`staff_second_review` is off (the default):

- no same-person check runs: a staff member may approve work they made, sent or own;
- whatever is sent in by someone who holds the staff right to approve it is approved at once, through
  the flow's own approval step (same checks, same audit, same emails). Anything an artist without that
  right sends still waits for staff, as before.

The owner turns `STAFF_SECOND_REVIEW=true` on when more staff join; then everything is as before.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError
from cornerroom.infra.settings import Settings, get_settings

log = logging.getLogger(__name__)


def second_review_on(settings: Settings | None = None) -> bool:
    """True when someone other than the maker must approve (STAFF_SECOND_REVIEW=true)."""
    return bool((settings or get_settings()).staff_second_review)


async def approve_at_once(
    session: AsyncSession,
    approve: Callable[[], Awaitable[Any]],
    *,
    settings: Settings | None = None,
) -> bool:
    """Run the flow's own approval for what was just sent, when the second review is off.

    The approval runs in a savepoint with the sender's own auth context, so it only goes through when
    the sender really may approve it (permission, workspace, state). Any refusal leaves the item
    waiting for staff exactly as it was sent, and returns False. Never raises a domain refusal.
    """
    if second_review_on(settings):
        return False
    try:
        async with session.begin_nested():
            await approve()
    except AppError as exc:
        log.debug("approve_at_once: left waiting for staff (%s)", exc.code)
        return False
    return True
