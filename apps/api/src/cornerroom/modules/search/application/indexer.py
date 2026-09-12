"""Search indexer. Upsert by (entity_type, entity_id). Default visibility UNAVAILABLE."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import NotFoundError
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    ARTIST_ACTIVATED,
    ARTIST_SUSPENDED,
    BAND_MEMBER_CHANGED,
    DomainEvent,
    EVENT_CANCELLED,
    EVENT_COMPLETED,
    EVENT_POSTPONED,
    EVENT_PUBLISHED,
    METADATA_CORRECTED,
    RELEASE_RELEASED,
    RELEASE_STAGE_CHANGED,
    TRACK_APPROVED,
    TRACK_RELEASED,
    TRACK_TAKEN_DOWN,
)
from cornerroom.modules.artists.application.service import ArtistService
from cornerroom.modules.events.application.service import EventService
from cornerroom.modules.music.application.service import MusicService
from cornerroom.modules.search.domain.models import SearchDocument
from cornerroom.modules.search.domain.visibility import (
    ENTITY_ARTIST,
    ENTITY_BAND,
    ENTITY_EVENT,
    ENTITY_RELEASE,
    ENTITY_TRACK,
    ENTITY_VENUE,
    VISIBILITY_UNAVAILABLE,
    build_searchable_text,
    visibility_public_or_unavailable,
)

SEARCH_EVENT_TYPES = frozenset(
    {
        ARTIST_ACTIVATED,
        ARTIST_SUSPENDED,
        BAND_MEMBER_CHANGED,
        EVENT_PUBLISHED,
        EVENT_CANCELLED,
        EVENT_POSTPONED,
        EVENT_COMPLETED,
        TRACK_APPROVED,
        TRACK_RELEASED,
        TRACK_TAKEN_DOWN,
        RELEASE_RELEASED,
        RELEASE_STAGE_CHANGED,
        METADATA_CORRECTED,
    }
)


class SearchIndexer:
    def __init__(self, session: AsyncSession, clock: Clock | None = None) -> None:
        self.session = session
        self.clock = clock or SystemClock()
        self.artists = ArtistService(session)
        self.music = MusicService(session)
        self.events = EventService(session)

    async def upsert(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        organization_id: UUID | None,
        visibility: str,
        title: str,
        subtitle: str | None,
        searchable_text: str,
        source_version: int | None,
    ) -> SearchDocument:
        stmt = select(SearchDocument).where(
            SearchDocument.entity_type == entity_type,
            SearchDocument.entity_id == entity_id,
        )
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        now = self.clock.now()
        vis = visibility or VISIBILITY_UNAVAILABLE
        text = searchable_text or ""
        if row is None:
            row = SearchDocument(
                entity_type=entity_type,
                entity_id=entity_id,
                organization_id=organization_id,
                visibility=vis,
                title=title,
                subtitle=subtitle,
                searchable_text=text,
                source_version=source_version,
                indexed_at=now,
            )
            self.session.add(row)
        else:
            row.organization_id = organization_id
            row.visibility = vis
            row.title = title
            row.subtitle = subtitle
            row.searchable_text = text
            row.source_version = source_version
            row.indexed_at = now
        await self.session.flush()
        return row

    async def ingest_event(self, event: DomainEvent) -> SearchDocument | None:
        if event.event_type not in SEARCH_EVENT_TYPES:
            return None
        if event.event_type in {ARTIST_ACTIVATED, ARTIST_SUSPENDED}:
            return await self.index_artist(event.aggregate_id)
        if event.event_type == BAND_MEMBER_CHANGED:
            return await self.index_band(event.aggregate_id)
        if event.event_type in {
            EVENT_PUBLISHED,
            EVENT_CANCELLED,
            EVENT_POSTPONED,
            EVENT_COMPLETED,
        }:
            return await self.index_event(event.aggregate_id)
        if event.event_type in {TRACK_APPROVED, TRACK_RELEASED, TRACK_TAKEN_DOWN}:
            return await self.index_track(event.aggregate_id)
        if event.event_type in {RELEASE_RELEASED, RELEASE_STAGE_CHANGED}:
            return await self.index_release(event.aggregate_id)
        if event.event_type == METADATA_CORRECTED:
            if event.aggregate_type == "Track":
                return await self.index_track(event.aggregate_id)
            if event.aggregate_type == "Release":
                return await self.index_release(event.aggregate_id)
            return None
        return None

    async def index_artist(self, artist_id: UUID) -> SearchDocument | None:
        try:
            artist = await self.artists.get_artist_row(artist_id)
        except NotFoundError:
            return None
        # legal_name is excluded (PII / not public copy).
        return await self.upsert(
            entity_type=ENTITY_ARTIST,
            entity_id=artist.id,
            organization_id=artist.primary_org_id,
            visibility=visibility_public_or_unavailable(self.artists._is_public_artist(artist)),
            title=artist.stage_name,
            subtitle=None,
            searchable_text=build_searchable_text(artist.stage_name, artist.bio),
            source_version=artist.version,
        )

    async def index_band(self, band_id: UUID) -> SearchDocument | None:
        try:
            band = await self.artists.get_band_row(band_id)
        except NotFoundError:
            return None
        return await self.upsert(
            entity_type=ENTITY_BAND,
            entity_id=band.id,
            organization_id=band.primary_org_id,
            visibility=visibility_public_or_unavailable(self.artists._is_public_band(band)),
            title=band.name,
            subtitle=None,
            searchable_text=build_searchable_text(band.name, band.bio),
            source_version=band.version,
        )

    async def index_track(self, track_id: UUID) -> SearchDocument | None:
        try:
            track = await self.music.get_track_row(track_id)
        except NotFoundError:
            return None
        # ISRC is a catalog identifier, not money/KYC; still omit to keep index public-copy only.
        return await self.upsert(
            entity_type=ENTITY_TRACK,
            entity_id=track.id,
            organization_id=track.primary_org_id,
            visibility=visibility_public_or_unavailable(self.music._is_public_track(track)),
            title=track.title,
            subtitle=None,
            searchable_text=build_searchable_text(track.title),
            source_version=track.version,
        )

    async def index_release(self, release_id: UUID) -> SearchDocument | None:
        try:
            release = await self.music.get_release_row(release_id)
        except NotFoundError:
            return None
        return await self.upsert(
            entity_type=ENTITY_RELEASE,
            entity_id=release.id,
            organization_id=release.primary_org_id,
            visibility=visibility_public_or_unavailable(self.music._is_public_release(release)),
            title=release.title,
            subtitle=release.release_type,
            searchable_text=build_searchable_text(release.title, release.release_type),
            source_version=release.version,
        )

    async def index_event(self, event_id: UUID) -> SearchDocument | None:
        try:
            event = await self.events.get_event_row(event_id)
        except NotFoundError:
            return None
        return await self.upsert(
            entity_type=ENTITY_EVENT,
            entity_id=event.id,
            organization_id=event.organization_id,
            visibility=visibility_public_or_unavailable(self.events._is_public(event)),
            title=event.title,
            subtitle=None,
            searchable_text=build_searchable_text(event.title, event.description),
            source_version=event.version,
        )

    async def index_venue(self, venue_id: UUID) -> SearchDocument | None:
        """No _is_public_venue rule and no VenueActivated event — always UNAVAILABLE."""
        try:
            venue = await self.events.get_venue_row(venue_id)
        except NotFoundError:
            return None
        return await self.upsert(
            entity_type=ENTITY_VENUE,
            entity_id=venue.id,
            organization_id=venue.organization_id,
            visibility=VISIBILITY_UNAVAILABLE,
            title=venue.name,
            subtitle=None,
            searchable_text=build_searchable_text(venue.name),
            source_version=venue.version,
        )

    async def rebuild(self) -> int:
        """Full rebuild for gaps (no ArtistUpdated / VenueActivated events)."""
        count = 0
        for artist_id in await self.artists.list_ids_for_projection():
            if await self.index_artist(artist_id):
                count += 1
        for band_id in await self.artists.list_ids_for_projection_bands():
            if await self.index_band(band_id):
                count += 1
        for track_id in await self.music.list_ids_for_projection_tracks():
            if await self.index_track(track_id):
                count += 1
        for release_id in await self.music.list_ids_for_projection_releases():
            if await self.index_release(release_id):
                count += 1
        for event_id in await self.events.list_ids_for_projection_events():
            if await self.index_event(event_id):
                count += 1
        for venue_id in await self.events.list_ids_for_projection_venues():
            if await self.index_venue(venue_id):
                count += 1
        return count
