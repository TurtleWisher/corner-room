"""Test-only stand-ins for the audio pipeline.

Since F2 (AUDIO_PHASE_1_DESIGN 5.3) nobody can mark a track version READY through the API; only
the media worker does, after its checks and playback copies. Catalog tests that are not about
audio use this helper to reach the READY state the worker would have produced.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import update


async def mark_version_ready(version_id: str | UUID) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.music.domain.models import TrackVersion

    async with get_session_factory()() as session:
        await session.execute(
            update(TrackVersion)
            .where(TrackVersion.id == UUID(str(version_id)))
            .values(status="READY", version=TrackVersion.version + 1)
        )
        await session.commit()
