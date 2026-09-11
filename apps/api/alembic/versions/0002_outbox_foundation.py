"""Phase 01 outbox/idempotency hardening.

Revision ID: 0002_outbox_foundation
Revises: 0001_foundation
Create Date: 2026-09-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_outbox_foundation"
down_revision: Union[str, Sequence[str], None] = "0001_foundation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "outbox_events",
        sa.Column("aggregate_type", sa.String(64), nullable=True),
        schema="infra",
    )
    op.add_column(
        "outbox_events",
        sa.Column("aggregate_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="infra",
    )
    op.add_column(
        "outbox_events",
        sa.Column("correlation_id", sa.String(128), nullable=True),
        schema="infra",
    )
    op.add_column(
        "outbox_events",
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        schema="infra",
    )
    op.add_column(
        "outbox_events",
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        schema="infra",
    )
    op.create_check_constraint(
        "ck_outbox_events_status",
        "outbox_events",
        "status IN ('PENDING','PUBLISHED','FAILED')",
        schema="infra",
    )
    op.create_index(
        "ix_outbox_events_status_next_attempt",
        "outbox_events",
        ["status", "next_attempt_at"],
        schema="infra",
    )

    op.add_column(
        "idempotency_records",
        sa.Column(
            "status",
            sa.String(32),
            nullable=False,
            server_default="COMPLETED",
        ),
        schema="infra",
    )
    op.alter_column(
        "idempotency_records",
        "response_code",
        existing_type=sa.Integer(),
        nullable=True,
        schema="infra",
    )


def downgrade() -> None:
    op.drop_column("idempotency_records", "status", schema="infra")
    op.alter_column(
        "idempotency_records",
        "response_code",
        existing_type=sa.Integer(),
        nullable=False,
        schema="infra",
    )
    op.drop_index("ix_outbox_events_status_next_attempt", table_name="outbox_events", schema="infra")
    op.drop_constraint("ck_outbox_events_status", "outbox_events", schema="infra")
    op.drop_column("outbox_events", "next_attempt_at", schema="infra")
    op.drop_column("outbox_events", "occurred_at", schema="infra")
    op.drop_column("outbox_events", "correlation_id", schema="infra")
    op.drop_column("outbox_events", "aggregate_id", schema="infra")
    op.drop_column("outbox_events", "aggregate_type", schema="infra")
