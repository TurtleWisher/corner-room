"""Who may stream music without buying it (owner, 2026-10-30, D-STREAM-02).

- Catalog staff: anyone holding `music.approve` in the organization that owns the song may stream
  every song of that organization (the owner and admins review and manage all of it).
- The music's own people: the artist who claimed the profile, or the admins of the band, may stream
  their own songs, including songs on their releases.

This is listening only. Downloads and offline saving still need a purchase (D-AUDIO-06, D-AUDIO-18),
and buying stays possible. Everyone else needs an entitlement, as before (Q-P9-04 / Q-P8-09).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.modules.authorization.application.service import AuthorizationService

STAFF_PERMISSION = "music.approve"


class StreamAccess:
    def __init__(self, session: AsyncSession, authz: AuthorizationService | None = None) -> None:
        self.session = session
        self.authz = authz or AuthorizationService(session)

    async def staff_org_ids(self, user_id: UUID) -> set[UUID]:
        """Organizations where this user is catalog staff."""
        out: set[UUID] = set()
        for membership in await self.authz.load_memberships(user_id):
            if membership.status != "ACTIVE":
                continue
            keys = await self.authz.permission_keys(user_id, organization_id=membership.organization_id)
            if STAFF_PERMISSION in keys:
                out.add(membership.organization_id)
        return out

    async def owned_profiles(self, user_id: UUID) -> tuple[set[UUID], set[UUID]]:
        """Artist and band profiles this user manages (the same people who may publish for them)."""
        from cornerroom.modules.artists.domain.models import Artist, Band, BandMember

        artists = set(
            (
                await self.session.execute(
                    select(Artist.id).where(
                        Artist.claimed_user_id == user_id, Artist.status == "ACTIVE", Artist.deleted_at.is_(None)
                    )
                )
            ).scalars()
        )
        bands = set(
            (
                await self.session.execute(
                    select(Band.id)
                    .join(BandMember, BandMember.band_id == Band.id)
                    .where(
                        BandMember.user_id == user_id,
                        BandMember.status == "ACTIVE",
                        BandMember.is_admin.is_(True),
                        BandMember.deleted_at.is_(None),
                        Band.status == "ACTIVE",
                        Band.deleted_at.is_(None),
                    )
                )
            ).scalars()
        )
        return artists, bands

    async def can_stream(self, user_id: UUID, track_id: UUID) -> bool:
        """Staff of the song's organization, or the people of its artist or band (or of a release
        it is on)."""
        from cornerroom.modules.music.domain.models import Release, ReleaseTrack, Track

        track = await self.session.get(Track, track_id)
        if track is None:
            return False
        if track.primary_org_id is not None:
            keys = await self.authz.permission_keys(user_id, organization_id=track.primary_org_id)
            if STAFF_PERMISSION in keys:
                return True
        artists, bands = await self.owned_profiles(user_id)
        if not artists and not bands:
            return False
        if track.primary_artist_id in artists or track.primary_band_id in bands:
            return True
        on_release = (
            await self.session.execute(
                select(Release.id)
                .join(ReleaseTrack, ReleaseTrack.release_id == Release.id)
                .where(ReleaseTrack.track_id == track_id, self._profile_filter(Release, artists, bands))
                .limit(1)
            )
        ).first()
        return on_release is not None

    async def track_ids(self, user_id: UUID) -> list[UUID]:
        """Every song this user may stream without buying, for the web app's Play buttons."""
        from cornerroom.modules.music.domain.models import Release, ReleaseTrack, Track

        orgs = await self.staff_org_ids(user_id)
        artists, bands = await self.owned_profiles(user_id)
        conditions = []
        if orgs:
            conditions.append(Track.primary_org_id.in_(orgs))
        if artists or bands:
            conditions.append(self._profile_filter(Track, artists, bands))
            on_releases = (
                select(ReleaseTrack.track_id)
                .join(Release, Release.id == ReleaseTrack.release_id)
                .where(self._profile_filter(Release, artists, bands))
            )
            conditions.append(Track.id.in_(on_releases))
        if not conditions:
            return []
        rows = await self.session.execute(select(Track.id).where(Track.deleted_at.is_(None), or_(*conditions)))
        return list(rows.scalars())

    @staticmethod
    def _profile_filter(model, artists: set[UUID], bands: set[UUID]):
        parts = []
        if artists:
            parts.append(model.primary_artist_id.in_(artists))
        if bands:
            parts.append(model.primary_band_id.in_(bands))
        return or_(*parts) if parts else model.id.is_(None)
