"""Fixture graph smoke test — construction only. No consumers, no rebuild, no aggregation."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import pytest

from cornerroom.modules.music.domain.models import ReleaseTrack
from tests.integration.phase13.graph import Phase13Graph, membership_org_id, role_permission_keys


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase13_fixture_graph(
    pg_session: AsyncSession,
    p13_graph: Phase13Graph,
) -> None:
    g = p13_graph
    assert g.org_a.id != g.org_b.id
    assert g.org_a.name == "QA_P13_ORG_A"
    assert g.org_b.name == "QA_P13_ORG_B"
    assert g.org_a.status == "ACTIVE"
    assert g.org_b.status == "ACTIVE"

    assert await membership_org_id(pg_session, g.user_a.id, g.org_a.id) == g.org_a.id
    assert await membership_org_id(pg_session, g.user_b.id, g.org_b.id) == g.org_b.id
    assert await membership_org_id(pg_session, g.analyst_a.id, g.org_a.id) == g.org_a.id
    assert await membership_org_id(pg_session, g.marketing_a.id, g.org_a.id) == g.org_a.id

    analyst_keys = await role_permission_keys(pg_session, "analyst")
    assert "analytics.read" in analyst_keys
    assert "finance.read" not in analyst_keys
    assert "finance.post" not in analyst_keys

    marketing_keys = await role_permission_keys(pg_session, "marketing_manager")
    assert "campaign.write" in marketing_keys
    assert "finance.post" not in marketing_keys

    assert g.artist_a.primary_org_id == g.org_a.id
    assert g.artist_b.primary_org_id == g.org_b.id
    assert g.artist_a.status == "ACTIVE"
    assert g.artist_private_a.status == "APPLIED"
    assert g.band_a.primary_org_id == g.org_a.id
    assert g.release_a.primary_org_id == g.org_a.id
    assert g.release_a.primary_artist_id == g.artist_a.id
    assert g.track_a.primary_org_id == g.org_a.id
    assert g.track_a.primary_artist_id == g.artist_a.id
    assert g.event_a.organization_id == g.org_a.id
    assert g.event_b.organization_id == g.org_b.id
    assert g.campaign_a.organization_id == g.org_a.id
    assert g.campaign_b.organization_id == g.org_b.id

    link = (
        await pg_session.execute(
            select(ReleaseTrack).where(
                ReleaseTrack.release_id == g.release_a.id,
                ReleaseTrack.track_id == g.track_a.id,
            )
        )
    ).scalar_one()
    assert link.position == 1
