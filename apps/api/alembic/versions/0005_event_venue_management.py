"""Phase 04 event and venue management.

Revision ID: 0005_event_venue_management
Revises: 0004_organizations_workspace
Create Date: 2026-09-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_event_venue_management"
down_revision: Union[str, Sequence[str], None] = "0004_organizations_workspace"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS events"))

    op.create_table(
        "venues",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("address", postgresql.JSONB(), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('DRAFT','ACTIVE','INACTIVE')", name="ck_venues_status"),
        sa.CheckConstraint("capacity >= 0", name="ck_venues_capacity_non_negative"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_venues_organization_id_organizations",
        ),
        schema="events",
    )
    op.create_index("ix_venues_organization_id", "venues", ["organization_id"], schema="events")
    op.create_index("ix_venues_status", "venues", ["status"], schema="events")

    op.create_table(
        "events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("venue_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("postponed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column("postponement_reason", sa.Text(), nullable=True),
        sa.Column("previous_starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("previous_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resume_status", sa.String(32), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('DRAFT','PLANNED','PUBLISHED','TICKETING_OPEN','SALES_CLOSED',"
            "'LIVE','COMPLETED','SETTLED','ARCHIVED','CANCELLED','POSTPONED')",
            name="ck_events_status",
        ),
        sa.CheckConstraint(
            "ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at",
            name="ck_events_ends_after_starts",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_events_organization_id_organizations",
        ),
        sa.ForeignKeyConstraint(
            ["venue_id"],
            ["events.venues.id"],
            name="fk_events_venue_id_venues",
        ),
        schema="events",
    )
    op.create_index("ix_events_organization_id", "events", ["organization_id"], schema="events")
    op.create_index("ix_events_status", "events", ["status"], schema="events")
    op.create_index("ix_events_starts_at", "events", ["starts_at"], schema="events")
    op.create_index("ix_events_venue_id", "events", ["venue_id"], schema="events")

    op.create_table(
        "venue_bookings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("venue_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="CONFIRMED"),
        sa.Column("quoted_amount_minor", sa.Integer(), nullable=True),
        sa.Column("currency_code", sa.String(3), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('INQUIRED','HOLD','CONFIRMED','CANCELLED','COMPLETED')",
            name="ck_venue_bookings_status",
        ),
        sa.CheckConstraint("ends_at > starts_at", name="ck_venue_bookings_booking_ends_after_starts"),
        sa.ForeignKeyConstraint(
            ["venue_id"],
            ["events.venues.id"],
            name="fk_venue_bookings_venue_id_venues",
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.events.id"],
            name="fk_venue_bookings_event_id_events",
        ),
        schema="events",
    )
    op.create_index(
        "ix_venue_bookings_venue_range",
        "venue_bookings",
        ["venue_id", "starts_at", "ends_at"],
        schema="events",
    )
    op.create_index("ix_venue_bookings_event_id", "venue_bookings", ["event_id"], schema="events")
    op.create_index(
        "uq_venue_bookings_active_event",
        "venue_bookings",
        ["event_id"],
        unique=True,
        schema="events",
        postgresql_where=sa.text("status = 'CONFIRMED' AND deleted_at IS NULL AND event_id IS NOT NULL"),
    )

    op.create_table(
        "event_milestones",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("previous_state", sa.String(32), nullable=True),
        sa.Column("new_state", sa.String(32), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.events.id"],
            name="fk_event_milestones_event_id_events",
        ),
        schema="events",
    )
    op.create_index("ix_event_milestones_event_id", "event_milestones", ["event_id"], schema="events")


def downgrade() -> None:
    op.drop_index("ix_event_milestones_event_id", table_name="event_milestones", schema="events")
    op.drop_table("event_milestones", schema="events")
    op.drop_index("uq_venue_bookings_active_event", table_name="venue_bookings", schema="events")
    op.drop_index("ix_venue_bookings_event_id", table_name="venue_bookings", schema="events")
    op.drop_index("ix_venue_bookings_venue_range", table_name="venue_bookings", schema="events")
    op.drop_table("venue_bookings", schema="events")
    op.drop_index("ix_events_venue_id", table_name="events", schema="events")
    op.drop_index("ix_events_starts_at", table_name="events", schema="events")
    op.drop_index("ix_events_status", table_name="events", schema="events")
    op.drop_index("ix_events_organization_id", table_name="events", schema="events")
    op.drop_table("events", schema="events")
    op.drop_index("ix_venues_status", table_name="venues", schema="events")
    op.drop_index("ix_venues_organization_id", table_name="venues", schema="events")
    op.drop_table("venues", schema="events")
    op.execute(sa.text("DROP SCHEMA IF EXISTS events"))
