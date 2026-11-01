"""Header search shows each act once, with its picture (owner, 2026-11-01).

MIZULS showed twice as an artist with initials: the solo profile that moved to a band (D-BAND-01)
kept its public search document, and a band's own artist row (D-ARTIST-UNIFY-01) is the same act
as the band. Hits now carry the approved picture's asset id.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.settings import Settings
from cornerroom.modules.artists.domain.models import Artist, Band
from cornerroom.modules.documents.domain.models import MediaAsset
from cornerroom.modules.search.application.indexer import SearchIndexer
from cornerroom.modules.search.application.service import SearchService
from cornerroom.modules.search.domain.models import SearchDocument
from cornerroom.modules.search.domain.visibility import (
    ENTITY_ARTIST,
    ENTITY_BAND,
    VISIBILITY_PUBLIC,
    VISIBILITY_UNAVAILABLE,
)


async def _picture(session: AsyncSession) -> MediaAsset:
    asset = MediaAsset(
        storage_class="profile_image", bucket="local", object_key=f"portraits/{uuid4()}.webp",
        mime="image/webp", byte_size=10, sha256="2" * 64, status="READY", scan_status="CLEAN",
    )
    session.add(asset)
    await session.flush()
    return asset


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_one_act_once_with_its_picture(pg_session: AsyncSession, settings: Settings) -> None:
    name = f"QA_ACT_{uuid4().hex[:8]}"
    picture = await _picture(pg_session)
    # The solo profile, later moved to a band and soft-deleted (its document stayed PUBLIC).
    solo = Artist(stage_name=name, status="ACTIVE", portrait_asset_id=picture.id)
    pg_session.add(solo)
    await pg_session.flush()
    indexer = SearchIndexer(pg_session)
    await indexer.index_artist(solo.id)
    mirror = Artist(kind="BAND", stage_name=name, status="ACTIVE", portrait_asset_id=picture.id)
    pg_session.add(mirror)
    await pg_session.flush()
    band = Band(id=mirror.id, name=name, status="ACTIVE", portrait_asset_id=picture.id)
    pg_session.add(band)
    solo.deleted_at = solo.created_at
    await pg_session.flush()
    await indexer.index_band(band.id)
    # The band's artist row indexed as an artist, as a profile change could before this fix.
    await indexer.upsert(
        entity_type=ENTITY_ARTIST, entity_id=band.id, organization_id=None, visibility=VISIBILITY_PUBLIC,
        title=name, subtitle=None, searchable_text=name, source_version=1,
    )

    svc = SearchService(pg_session, settings=settings)
    hits, _ = await svc.query(None, q=name)
    acts = [h for h in hits if h.title == name]
    assert [(h.entity_type, h.entity_id) for h in acts] == [(ENTITY_BAND, band.id)]
    assert acts[0].picture == picture.id
    assert acts[0].route == f"/bands/{band.id}"

    # The indexer itself hides what no longer projects.
    await indexer.index_artist(solo.id)
    await indexer.index_artist(band.id)
    rows = (
        await pg_session.execute(
            select(SearchDocument.entity_type, SearchDocument.entity_id, SearchDocument.visibility).where(
                SearchDocument.title == name
            )
        )
    ).all()
    assert {(r.entity_type, r.entity_id): r.visibility for r in rows} == {
        (ENTITY_ARTIST, solo.id): VISIBILITY_UNAVAILABLE,
        (ENTITY_ARTIST, band.id): VISIBILITY_UNAVAILABLE,
        (ENTITY_BAND, band.id): VISIBILITY_PUBLIC,
    }


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_rebuild_hides_documents_with_no_source(pg_session: AsyncSession, settings: Settings) -> None:
    name = f"QA_GONE_{uuid4().hex[:8]}"
    gone = Artist(stage_name=name, status="ACTIVE")
    pg_session.add(gone)
    await pg_session.flush()
    indexer = SearchIndexer(pg_session)
    await indexer.index_artist(gone.id)
    gone.deleted_at = gone.created_at
    await pg_session.flush()
    await indexer.rebuild()
    row = (
        await pg_session.execute(select(SearchDocument).where(SearchDocument.entity_id == gone.id))
    ).scalar_one()
    assert row.visibility == VISIBILITY_UNAVAILABLE
    solo_hits, _ = await SearchService(pg_session, settings=settings).query(None, q=name)
    assert solo_hits == []
