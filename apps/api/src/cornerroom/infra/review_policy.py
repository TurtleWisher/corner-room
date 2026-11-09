"""Who has to approve what (owner, 2026-11-07, D-REVIEW-SOLO-01; 2026-11-09, D-REVIEW-ARTIST-01).

Two rules from the owner:

- **Artists always wait for staff.** Anything sent in by someone on the act's own team (its owner
  or a manager) waits for Corner Room staff, even when that person also holds a staff right. The
  owner runs MIZULS and is staff too: what they send as MIZULS waits like any artist's work, and
  they approve it from the staff side.
- **Staff never wait.** Whatever staff send in for an act they are not part of is approved at once,
  through the flow's own approval step (same checks, same audit, same emails).

While `staff_second_review` is off (the default, D-REVIEW-SOLO-01) no same-person check runs either,
so the one staff member may approve work they made or own. `STAFF_SECOND_REVIEW=true` brings back
"someone else must approve this" (and turns off approving at once) for when more staff join.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext

log = logging.getLogger(__name__)


def second_review_on(settings: Settings | None = None) -> bool:
    """True when someone other than the maker must approve (STAFF_SECOND_REVIEW=true)."""
    return bool((settings or get_settings()).staff_second_review)


async def on_acts_team(session: AsyncSession, user_id: UUID, act_id: UUID | None) -> bool:
    """True when the person runs this act (its owner or a manager). Unknown act: treated as theirs,
    so nothing is approved at once by mistake."""
    if act_id is None:
        return True
    from cornerroom.modules.artists.application.team import team_user_ids

    return user_id in await team_user_ids(session, act_id)


async def approves_at_once(session: AsyncSession, ctx: AuthContext, act_id: UUID | None, *, settings: Settings | None = None) -> bool:
    """Whether what this person sends for this act skips the wait (staff outside the act's team)."""
    if second_review_on(settings):
        return False
    return not await on_acts_team(session, ctx.user_id, act_id)


async def approve_at_once(
    session: AsyncSession,
    approve: Callable[[], Awaitable[Any]],
    *,
    ctx: AuthContext,
    act_id: UUID | None,
    settings: Settings | None = None,
) -> bool:
    """Run the flow's own approval for what was just sent, when staff sent it (see the module notes).

    `act_id` is the artist or band the work belongs to (a band's id is also its artist row's id,
    D-ARTIST-UNIFY-01). Anyone on that act's team is an artist here and waits. The approval runs in
    a savepoint with the sender's own auth context, so it only goes through when the sender really
    may approve it (permission, workspace, state). Any refusal leaves the item waiting for staff
    exactly as it was sent, and returns False. Never raises a domain refusal.
    """
    if not await approves_at_once(session, ctx, act_id, settings=settings):
        return False
    try:
        async with session.begin_nested():
            await approve()
    except AppError as exc:
        log.debug("approve_at_once: left waiting for staff (%s)", exc.code)
        return False
    return True
