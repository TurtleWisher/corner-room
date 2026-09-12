"""Search integration: rebuild, public predicates, uniqueness, guest types, cursor."""

from __future__ import annotations

from dataclasses import asdict

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

import pytest

from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.outbox_dispatch import dispatch_outbox
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.events import ARTIST_ACTIVATED, EVENT_PUBLISHED, TRACK_RELEASED
from cornerroom.modules.search.application.indexer import SearchIndexer
from cornerroom.modules.search.application.service import SearchService
from cornerroom.modules.search.domain.models import SearchDocument
from cornerroom.modules.search.domain.visibility import (
    ENTITY_ARTIST,
    ENTITY_VENUE,
    GUEST_ENTITY_TYPES,
    VISIBILITY_PUBLIC,
    VISIBILITY_UNAVAILABLE,
)
from tests.integration.phase13.graph import Phase13Graph, domain_event


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_search_indexing_via_outbox_then_query(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
    settings: Settings,
) -> None:
    g = p13_graph
    for event_type, aggregate_type, aggregate_id, producer in (
        (ARTIST_ACTIVATED, "Artist", g.artist_a.id, "artists"),
        (TRACK_RELEASED, "Track", g.track_a.id, "music"),
        (EVENT_PUBLISHED, "Event", g.event_a.id, "events"),
    ):
        event = domain_event(
            event_type=event_type,
            producer=producer,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload={},
            organization_id=g.org_a.id,
        )
        row = await enqueue_outbox(pg_session, event)
        await dispatch_outbox(pg_session, row)

    svc = SearchService(pg_session, settings=settings)
    items, _cursor = await svc.query(None, q="QA_P13_ARTIST_A")
    ids = {hit.entity_id for hit in items}
    assert g.artist_a.id in ids
    assert all(hit.entity_type in GUEST_ENTITY_TYPES for hit in items)
    assert all(hit.visibility == VISIBILITY_PUBLIC for hit in items)
    for hit in items:
        dumped = asdict(hit)
        assert "password" not in dumped
        assert "token" not in dumped
        assert "amount_minor" not in str(dumped)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_search_rebuild_no_duplicates_venues_unavailable(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
    settings: Settings,
) -> None:
    g = p13_graph
    indexer = SearchIndexer(pg_session)
    first = await indexer.rebuild()
    second = await indexer.rebuild()
    assert first == second
    total = (
        await pg_session.execute(select(func.count()).select_from(SearchDocument))
    ).scalar_one()
    rows = (
        await pg_session.execute(select(SearchDocument.entity_type, SearchDocument.entity_id))
    ).all()
    assert total == len(rows)
    assert len(rows) == len(set(rows))

    venue_doc = (
        await pg_session.execute(
            select(SearchDocument).where(
                SearchDocument.entity_type == ENTITY_VENUE,
                SearchDocument.entity_id == g.venue_a.id,
            )
        )
    ).scalar_one()
    assert venue_doc.visibility == VISIBILITY_UNAVAILABLE

    private = (
        await pg_session.execute(
            select(SearchDocument).where(
                SearchDocument.entity_type == ENTITY_ARTIST,
                SearchDocument.entity_id == g.artist_private_a.id,
            )
        )
    ).scalar_one()
    assert private.visibility == VISIBILITY_UNAVAILABLE

    public_artist = (
        await pg_session.execute(
            select(SearchDocument).where(
                SearchDocument.entity_type == ENTITY_ARTIST,
                SearchDocument.entity_id == g.artist_a.id,
            )
        )
    ).scalar_one()
    assert public_artist.visibility == VISIBILITY_PUBLIC

    svc = SearchService(pg_session, settings=settings)
    guest, _ = await svc.query(None, q="QA_P13_VENUE_A")
    assert all(hit.entity_id != g.venue_a.id for hit in guest)
    assert all(hit.entity_type != ENTITY_VENUE for hit in guest)
    guest_user, _ = await svc.query(None, q="QA_P13", entity_type="USER")
    assert guest_user == []
    guest_org, _ = await svc.query(None, q="QA_P13", entity_type="ORGANIZATION")
    assert guest_org == []
    guest_campaign, _ = await svc.query(None, q="QA_P13", entity_type="CAMPAIGN")
    assert guest_campaign == []
    guest_venue_type, _ = await svc.query(None, q="QA_P13", entity_type="VENUE")
    assert guest_venue_type == []

    empty, cursor = await svc.query(None, q="")
    assert empty == []
    assert cursor is None
    unknown, _ = await svc.query(None, q="zzzxnotap13query")
    assert unknown == []


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_search_org_filter_is_not_authority_and_cursor(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
    settings: Settings,
) -> None:
    g = p13_graph
    await SearchIndexer(pg_session).rebuild()
    svc = SearchService(pg_session, settings=settings)
    ctx_a = AuthContext(
        user_id=g.analyst_a.id,
        request_id="qa-p13-search",
        organization_id=g.org_a.id,
    )
    filtered, _ = await svc.query(ctx_a, q="QA_P13", organization_id=g.org_b.id)
    for hit in filtered:
        assert hit.organization_id == g.org_b.id
        assert hit.visibility == VISIBILITY_PUBLIC
        assert hit.entity_id != g.artist_private_a.id

    first_page, cursor = await svc.query(None, q="QA_P13", limit=2)
    assert len(first_page) <= 2
    if cursor is not None:
        second_page, _ = await svc.query(None, q="QA_P13", limit=2, cursor=cursor)
        first_ids = [hit.entity_id for hit in first_page]
        second_ids = [hit.entity_id for hit in second_page]
        assert set(first_ids).isdisjoint(second_ids)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_search_fts_and_unique_constraint(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
    settings: Settings,
) -> None:
    g = p13_graph
    await SearchIndexer(pg_session).rebuild()
    svc = SearchService(pg_session, settings=settings)
    exact, _ = await svc.query(None, q="QA_P13_ARTIST_A")
    assert any(hit.entity_id == g.artist_a.id for hit in exact)
    partial, _ = await svc.query(None, q="ARTIST_A")
    assert any(hit.entity_id == g.artist_a.id for hit in partial)
    case, _ = await svc.query(None, q="qa_p13_artist_a")
    assert any(hit.entity_id == g.artist_a.id for hit in case)

    names = (
        (
            await pg_session.execute(
                text(
                    """
                SELECT conname FROM pg_constraint
                WHERE conname = 'uq_search_documents_entity'
                """
                )
            )
        )
        .scalars()
        .all()
    )
    assert "uq_search_documents_entity" in names
