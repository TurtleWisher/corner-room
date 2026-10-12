"""Phase 15 Gate 2 — Alembic head, integrity objects, and honest RLS absence."""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

from cornerroom.modules.finance.domain.models import LedgerEntry, Payout

API_ROOT = Path(__file__).resolve().parents[1]
VERSIONS = API_ROOT / "alembic" / "versions"
REVISION_0015 = "0015_database_integrity"


def test_alembic_0015_is_in_the_linear_chain() -> None:
    cfg = Config(str(API_ROOT / "alembic.ini"))
    script = ScriptDirectory.from_config(cfg)
    # 0015 was the head at Phase 15; later additive revisions (0016+) build on it, one head only.
    assert len(script.get_heads()) == 1
    rev = script.get_revision(REVISION_0015)
    assert rev is not None
    assert rev.down_revision == "0014_notifications_search_analytics"


def test_0015_is_additive_and_does_not_enable_rls() -> None:
    text = (VERSIONS / "0015_database_integrity.py").read_text(encoding="utf-8")
    upgrade = text.split("def upgrade", 1)[1].split("def downgrade", 1)[0].upper()
    assert "ROW LEVEL" not in upgrade
    assert "CREATE POLICY" not in upgrade
    assert "USING (TRUE)" not in upgrade
    assert "CREATE ROLE" not in upgrade
    assert "BYPASSRLS" not in upgrade
    assert "FK_LEDGER_ENTRIES_ORGANIZATION_ID_ORGANIZATIONS" in upgrade
    assert "IX_PAYOUTS_ORGANIZATION_CREATED" in upgrade


def test_orm_ledger_entry_org_fk_and_payout_org_index() -> None:
    org_col = LedgerEntry.__table__.c.organization_id
    assert any(fk.column.table.name == "organizations" for fk in org_col.foreign_keys)
    ledger_indexes = {idx.name for idx in LedgerEntry.__table__.indexes}
    assert "ix_ledger_entries_organization_id" in ledger_indexes
    payout_indexes = {idx.name for idx in Payout.__table__.indexes}
    assert "ix_payouts_organization_created" in payout_indexes


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_integrity_objects_and_rls_not_enabled(pg_session) -> None:
    fk = (
        await pg_session.execute(
            text(
                """
                SELECT 1
                FROM information_schema.table_constraints
                WHERE constraint_schema = 'finance'
                  AND table_name = 'ledger_entries'
                  AND constraint_name = 'fk_ledger_entries_organization_id_organizations'
                  AND constraint_type = 'FOREIGN KEY'
                """
            )
        )
    ).scalar_one_or_none()
    assert fk == 1

    payout_idx = (
        await pg_session.execute(
            text(
                """
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = 'finance'
                  AND tablename = 'payouts'
                  AND indexname = 'ix_payouts_organization_created'
                """
            )
        )
    ).scalar_one_or_none()
    assert payout_idx == 1

    ledger_idx = (
        await pg_session.execute(
            text(
                """
                SELECT 1
                FROM pg_indexes
                WHERE schemaname = 'finance'
                  AND tablename = 'ledger_entries'
                  AND indexname = 'ix_ledger_entries_organization_id'
                """
            )
        )
    ).scalar_one_or_none()
    assert ledger_idx == 1

    rls_rows = (
        await pg_session.execute(
            text(
                """
                SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE (n.nspname, c.relname) IN (
                    ('finance', 'ledger_entries'),
                    ('ticketing', 'tickets'),
                    ('royalties', 'royalty_lines'),
                    ('documents', 'documents'),
                    ('documents', 'media_assets')
                )
                """
            )
        )
    ).all()
    assert len(rls_rows) == 5
    for _schema, _table, enabled, forced in rls_rows:
        assert enabled is False
        assert forced is False
