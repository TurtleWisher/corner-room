"""Phase 13 QA fixtures. Reuses root pg_session / settings; composes graph.py."""

from __future__ import annotations

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.settings import Settings
from tests.integration.phase13.graph import Phase13Graph, build_phase13_graph


@pytest_asyncio.fixture
async def p13_graph(pg_session: AsyncSession, settings: Settings) -> Phase13Graph:
    return await build_phase13_graph(pg_session, settings)
