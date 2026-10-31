"""Songs an artist or band is credited on but did not release (owner, 2026-10-31, D-CREDITS-06).

Their profile shows them apart from their own releases, as a portfolio of the work they did with
others: mixing, recording, artwork, playing on a song. A credit counts when it is linked to the
profile, or when its typed name is the profile's stage name and no other public profile has that
name (the same rule that makes the name a link on the song page, D-CREDITS-03). Only released
songs on released music count, and never the profile's own releases.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import NotFoundError
from cornerroom.modules.artists.domain.lifecycle import PUBLIC_ARTIST_STATUSES
from cornerroom.modules.artists.domain.models import Artist
from cornerroom.modules.music.domain.lifecycle import PUBLIC_RELEASE_STATUSES, PUBLIC_TRACK_STATUSES
from cornerroom.modules.music.domain.models import Credit, CreditRole, Release, ReleaseTrack, Track


def _name_key(column: Any) -> Any:
    """A name with case and spacing ignored, in SQL."""
    return func.lower(func.regexp_replace(func.trim(column), r"\s+", " ", "g"))


def role_words(role_key: str | None, instrument: str | None, labels: dict[str, str]) -> str:
    """What they did, as the song page says it: "Mixing & Mastering", "Guitars", "Producer"."""
    if role_key in {"custom", "musician"} and instrument:
        return instrument
    if role_key == "musician":
        return "Musician"
    return labels.get(role_key or "", (role_key or "Credit").replace("_", " ").capitalize())


async def credited_on(session: AsyncSession, artist_id: UUID) -> list[dict[str, Any]]:
    artist = await session.get(Artist, artist_id)
    if artist is None or artist.deleted_at is not None or artist.status not in PUBLIC_ARTIST_STATUSES:
        raise NotFoundError("Artist not found")
    key = " ".join(artist.stage_name.split()).lower()
    same_name = await session.scalar(
        select(func.count())
        .select_from(Artist)
        .where(Artist.deleted_at.is_(None), Artist.status.in_(tuple(PUBLIC_ARTIST_STATUSES)), _name_key(Artist.stage_name) == key)
    )
    match = Credit.artist_id == artist.id
    if same_name == 1:
        match = or_(match, and_(Credit.artist_id.is_(None), _name_key(Credit.display_name) == key))
    by = func.coalesce(Release.primary_artist_id, Release.primary_band_id)
    rows = (
        await session.execute(
            select(Credit, Track, Release)
            .join(Track, Track.id == Credit.track_id)
            .join(ReleaseTrack, ReleaseTrack.track_id == Track.id)
            .join(Release, Release.id == ReleaseTrack.release_id)
            .where(
                match,
                Credit.deleted_at.is_(None),
                Track.deleted_at.is_(None),
                Release.deleted_at.is_(None),
                Track.status.in_(tuple(PUBLIC_TRACK_STATUSES)),
                Release.status.in_(tuple(PUBLIC_RELEASE_STATUSES)),
                or_(by.is_(None), by != artist.id),
            )
            .order_by(Release.release_at.desc().nulls_last(), Release.title, ReleaseTrack.position, Credit.position)
        )
    ).all()
    if not rows:
        return []
    labels = {r.key: r.label_en for r in (await session.execute(select(CreditRole))).scalars()}
    act_ids = {r.Release.primary_artist_id or r.Release.primary_band_id for r in rows} - {None}
    acts = {a.id: a for a in (await session.execute(select(Artist).where(Artist.id.in_(act_ids)))).scalars()}
    songs: dict[UUID, dict[str, Any]] = {}
    for credit, track, release in rows:
        song = songs.get(track.id)
        if song is None:
            act = acts.get(release.primary_artist_id or release.primary_band_id)
            song = songs[track.id] = {
                "track_id": track.id,
                "track_title": track.title,
                "release_id": release.id,
                "release_title": release.title,
                "release_type": release.release_type,
                "release_at": release.release_at,
                "has_cover": release.cover_asset_id is not None,
                "by_id": act.id if act else None,
                "by_name": act.stage_name if act else None,
                "by_kind": act.kind if act else None,
                "roles": [],
            }
        words = role_words(credit.role_key or credit.credit_role, credit.instrument, labels)
        if words not in song["roles"]:
            song["roles"].append(words)
    return list(songs.values())
