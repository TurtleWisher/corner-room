"""Move a solo artist profile to a band profile (owner, 2026-10-27, D-BAND-01).

MIZULS launched as a solo artist profile because no band could have an admin then. This moves the
public identity to a band in one transaction: a new active band with the same name, bio and
picture; the account that ran the artist becomes the band's admin member and owner (its managers
come along); songs, releases,
followers, event bookings, Studio uploads and intake records point at the band; credits that named
the artist keep its name. The solo profile is then soft-deleted so it disappears from public
pages, search and Studio.

Money stays where it is (owner, 2026-10-27): orders, payments, entitlements, ledger rows and
royalty rights keep their existing references, and how band members share royalties is decided
later (OPEN). The same move runs when staff activate an application made as a band.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import select, update

from cornerroom.infra.errors import AppError, ConflictError, NotFoundError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.events import (
    ARTIST_PROFILE_CHANGED,
    BAND_MEMBER_CHANGED,
    METADATA_CORRECTED,
)
from cornerroom.modules.artists.domain.models import Artist, Band, BandMember, Follow

if TYPE_CHECKING:
    from cornerroom.modules.artists.application.service import ArtistService

BAND_KIND = "BAND"


def wants_band(artist: Artist) -> bool:
    """An application made as a band (the applicant chose "Band" when applying)."""
    return (artist.extra_metadata or {}).get("profile_kind") == BAND_KIND


async def move_artist_to_band(
    svc: ArtistService, ctx: AuthContext, artist_id: UUID, *, staff_checked: bool = False
) -> Band:
    """Staff action. Returns the band; running it again for the same artist is refused."""
    session = svc.session
    artist = await session.get(Artist, artist_id)
    if artist is None or artist.deleted_at is not None:
        raise NotFoundError("Artist not found")
    if not staff_checked:
        org_id = artist.primary_org_id
        if org_id is None or not await svc._can_staff_manage_workspace(ctx, org_id):
            raise NotFoundError("Artist not found")
        await svc._require_active_org(org_id)
    if artist.status != "ACTIVE":
        raise AppError("INVALID_TRANSITION", "Only an active artist profile can become a band", 409)
    from cornerroom.modules.artists.application.team import (
        add_active_manager,
        make_owner,
        owner_user_id,
        team_user_ids,
    )

    owner = await owner_user_id(session, artist.id) or artist.claimed_user_id
    if owner is None:
        raise AppError("VALIDATION_ERROR", "This profile has no account to make the band's admin", 422)
    if (artist.extra_metadata or {}).get("moved_to_band_id"):
        raise ConflictError("This profile has already become a band")

    now = svc.clock.now()
    band = Band(
        name=artist.stage_name,
        bio=artist.bio,
        portrait_asset_id=artist.portrait_asset_id,
        status="ACTIVE",
        primary_org_id=artist.primary_org_id,
        created_by=ctx.user_id,
        updated_by=ctx.user_id,
    )
    session.add(band)
    await session.flush()
    session.add(
        BandMember(
            band_id=band.id,
            user_id=owner,
            artist_id=artist.id,
            status="ACTIVE",
            is_admin=True,
            started_at=now,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
    )

    # The same people run the band: the owner, and any managers (D-ARTIST-UNIFY-01).
    managers = await team_user_ids(session, artist.id) - {owner}
    await session.flush()
    await make_owner(session, band.id, owner, by=ctx.user_id)
    for user_id in managers:
        await add_active_manager(session, band.id, user_id, by=ctx.user_id)

    from cornerroom.modules.documents.domain.models import MediaAsset
    from cornerroom.modules.events.domain.models import EventLineup
    from cornerroom.modules.music.domain.models import Credit, IntakeRecord, Release, Track, TrackVersion

    moved: dict[str, Any] = {}
    releases = list(
        (await session.execute(select(Release.id).where(Release.primary_artist_id == artist.id))).scalars()
    )
    tracks = list((await session.execute(select(Track.id).where(Track.primary_artist_id == artist.id))).scalars())
    await session.execute(
        update(Release)
        .where(Release.primary_artist_id == artist.id)
        .values(primary_artist_id=None, primary_band_id=band.id, updated_by=ctx.user_id)
    )
    await session.execute(
        update(Track)
        .where(Track.primary_artist_id == artist.id)
        .values(primary_artist_id=None, primary_band_id=band.id, updated_by=ctx.user_id)
    )
    moved["releases"] = len(releases)
    moved["tracks"] = len(tracks)
    # Credits keep the person (and any royalty link) but carry the name, since the solo profile
    # will no longer be listed publicly.
    named = await session.execute(
        update(Credit)
        .where(Credit.artist_id == artist.id, Credit.display_name.is_(None))
        .values(display_name=artist.stage_name)
    )
    moved["credits_named"] = named.rowcount or 0
    lineups = await session.execute(
        update(EventLineup)
        .where(EventLineup.artist_id == artist.id)
        .values(artist_id=None, band_id=band.id)
    )
    moved["event_lineups"] = lineups.rowcount or 0
    for model in (MediaAsset, TrackVersion):
        await session.execute(
            update(model)
            .where(model.on_behalf_profile_type == "artist", model.on_behalf_profile_id == artist.id)
            .values(on_behalf_profile_type="band", on_behalf_profile_id=band.id)
        )
    await session.execute(
        update(IntakeRecord)
        .where(IntakeRecord.profile_type == "artist", IntakeRecord.profile_id == artist.id)
        .values(profile_type="band", profile_id=band.id)
    )
    # Followers follow the band now; someone already following both keeps one follow.
    followers = list(
        (
            await session.execute(
                select(Follow).where(
                    Follow.target_type == "ARTIST",
                    Follow.target_id == artist.id,
                    Follow.status == "ACTIVE",
                    Follow.deleted_at.is_(None),
                )
            )
        ).scalars()
    )
    for follow in followers:
        already = (
            await session.execute(
                select(Follow.id).where(
                    Follow.user_id == follow.user_id,
                    Follow.target_type == "BAND",
                    Follow.target_id == band.id,
                    Follow.status == "ACTIVE",
                    Follow.deleted_at.is_(None),
                )
            )
        ).first()
        if already:
            follow.deleted_at = now
        else:
            follow.target_type = "BAND"
            follow.target_id = band.id
    moved["followers"] = len(followers)

    artist.extra_metadata = {**(artist.extra_metadata or {}), "moved_to_band_id": str(band.id)}
    artist.deleted_at = now
    artist.updated_by = ctx.user_id
    await session.flush()

    for aggregate_type, aggregate_id, event_type in [
        ("Band", band.id, BAND_MEMBER_CHANGED),
        ("Artist", artist.id, ARTIST_PROFILE_CHANGED),
        *[("Release", rid, METADATA_CORRECTED) for rid in releases],
        *[("Track", tid, METADATA_CORRECTED) for tid in tracks],
    ]:
        await svc._emit(
            event_type=event_type,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload={"band_id": str(band.id), "from_artist_id": str(artist.id)},
            ctx=ctx,
            organization_id=band.primary_org_id,
        )
    await svc.audit.record_from_auth(
        ctx,
        action="artist.moved_to_band",
        entity_type="Artist",
        entity_id=artist.id,
        previous_state={"stage_name": artist.stage_name, "status": "ACTIVE"},
        new_state={"band_id": str(band.id), **moved},
        organization_id=band.primary_org_id,
    )
    return band
