"""Plays before listen counting started (owner, 2026-10-28, D-LISTEN-02).

Listen counting began with the 2026-10-27 release (D-LISTEN-01); songs that were already out had
been played before that (Chaya Pore: 641 times). Staff record that number once per song; the
public count is that number plus every listen counted since. Content reviewers of the song's
workspace, or platform admins, may set it; every change is audited with the old and new number.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ForbiddenError, NotFoundError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.music.application.service import MusicService
from cornerroom.modules.music.domain.models import Track

# A sanity ceiling against typing mistakes, not a business rule.
MAX_LISTENS_BEFORE = 100_000_000


async def set_listens_before(session: AsyncSession, ctx: AuthContext, track_id: UUID, count: int, note: str | None) -> Track:
    music = MusicService(session)
    track = await music.get_track_row(track_id)
    allowed = track.primary_org_id is not None and await music._is_allowed(
        ctx.user_id, "music.approve", resource_type="track", resource_id=track.id, organization_id=track.primary_org_id
    )
    if not allowed:
        try:
            await AuthorizationService(session).authorize(ctx.user_id, "user.admin")
        except ForbiddenError as exc:
            raise NotFoundError("Track not found") from exc
    if count < 0 or count > MAX_LISTENS_BEFORE:
        raise AppError("VALIDATION_ERROR", "Enter a number of plays from 0 upwards", 422)
    previous = track.listens_before_counting
    track.listens_before_counting = count
    track.updated_by = ctx.user_id
    await music._flush_versioned()
    await AuditService(session).record_from_auth(
        ctx,
        action="track.listens_before_counting_set",
        entity_type="Track",
        entity_id=track.id,
        previous_state={"listens_before_counting": previous},
        new_state={"listens_before_counting": count, "note": " ".join((note or "").split())[:300] or None},
        organization_id=track.primary_org_id,
    )
    return track
