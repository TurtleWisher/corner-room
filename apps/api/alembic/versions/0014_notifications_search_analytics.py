"""Phase 13 Gate 2 - notifications completeness, search projection, analytics facts.

Revision ID: 0014_notifications_search_analytics
Revises: 0013_marketing_campaigns
Create Date: 2026-09-11

Does not rewrite 0001–0013. Does not duplicate Phase 1 notification tables.
Does not change outbox semantics. No analytics_ledger, stream_rate, unique_listeners,
CAC/ROAS, or attribution-as-truth columns.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014_notifications_search_analytics"
down_revision: Union[str, Sequence[str], None] = "0013_marketing_campaigns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SEARCH_TSV_SQL = (
    "to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || "
    "coalesce(subtitle, '') || ' ' || coalesce(searchable_text, ''))"
)


def upgrade() -> None:
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS search"))
    op.execute(sa.text("CREATE SCHEMA IF NOT EXISTS analytics"))

    # --- notifications: additive columns (do not recreate 0001 tables) ---
    op.add_column(
        "notifications",
        sa.Column("correlation_id", sa.String(128), nullable=True),
        schema="notifications",
    )
    op.add_column(
        "notifications",
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="notifications",
    )
    op.add_column(
        "notifications",
        sa.Column("category", sa.String(32), nullable=True),
        schema="notifications",
    )
    op.add_column(
        "notifications",
        sa.Column("consumer", sa.String(64), nullable=True),
        schema="notifications",
    )
    op.add_column(
        "notifications",
        sa.Column("source_event_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="notifications",
    )
    op.create_foreign_key(
        "fk_notifications_organization_id_organizations",
        "notifications",
        "organizations",
        ["organization_id"],
        ["id"],
        source_schema="notifications",
        referent_schema="identity",
    )
    op.create_check_constraint(
        "ck_notifications_status",
        "notifications",
        "status IN ('UNREAD','READ')",
        schema="notifications",
    )
    op.create_check_constraint(
        "ck_notifications_category",
        "notifications",
        "category IS NULL OR category IN ('TRANSACTIONAL','MARKETING','SECURITY')",
        schema="notifications",
    )
    op.create_check_constraint(
        "ck_notifications_ingest_pair",
        "notifications",
        "(source_event_id IS NULL AND consumer IS NULL) OR "
        "(source_event_id IS NOT NULL AND consumer IS NOT NULL)",
        schema="notifications",
    )
    op.create_index(
        "ix_notifications_user_status_created",
        "notifications",
        ["user_id", "status", "created_at"],
        schema="notifications",
    )
    op.create_index(
        "ix_notifications_organization_id",
        "notifications",
        ["organization_id"],
        schema="notifications",
    )
    op.create_index(
        "ix_notifications_correlation_id",
        "notifications",
        ["correlation_id"],
        schema="notifications",
    )
    op.create_index(
        "uq_notifications_ingest_idempotency",
        "notifications",
        ["consumer", "source_event_id", "type", "user_id"],
        unique=True,
        schema="notifications",
        postgresql_where=sa.text("source_event_id IS NOT NULL"),
    )

    op.add_column(
        "notification_deliveries",
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        schema="notifications",
    )
    op.add_column(
        "notification_deliveries",
        sa.Column("last_error", sa.String(2000), nullable=True),
        schema="notifications",
    )
    op.add_column(
        "notification_deliveries",
        sa.Column("provider_code", sa.String(32), nullable=True),
        schema="notifications",
    )
    op.create_check_constraint(
        "ck_notification_deliveries_status",
        "notification_deliveries",
        "status IN ('PENDING','SENT','DELIVERED','FAILED','SUPPRESSED')",
        schema="notifications",
    )
    op.create_index(
        "ix_notification_deliveries_status_next_attempt",
        "notification_deliveries",
        ["status", "next_attempt_at"],
        schema="notifications",
    )
    op.create_index(
        "ix_notification_deliveries_notification_id",
        "notification_deliveries",
        ["notification_id"],
        schema="notifications",
    )

    op.add_column(
        "notification_preferences",
        sa.Column("quiet_hours_start", sa.Time(), nullable=True),
        schema="notifications",
    )
    op.add_column(
        "notification_preferences",
        sa.Column("quiet_hours_end", sa.Time(), nullable=True),
        schema="notifications",
    )
    op.add_column(
        "notification_preferences",
        sa.Column("quiet_hours_timezone", sa.String(64), nullable=True),
        schema="notifications",
    )
    op.create_check_constraint(
        "ck_notification_preferences_quiet_hours_pair",
        "notification_preferences",
        "(quiet_hours_start IS NULL AND quiet_hours_end IS NULL AND quiet_hours_timezone IS NULL) OR "
        "(quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL AND quiet_hours_timezone IS NOT NULL)",
        schema="notifications",
    )

    # --- search projection (rebuildable; not catalog truth) ---
    op.create_table(
        "search_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("visibility", sa.String(32), nullable=False, server_default="UNAVAILABLE"),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("subtitle", sa.String(500), nullable=True),
        sa.Column("searchable_text", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "tsv",
            postgresql.TSVECTOR(),
            sa.Computed(SEARCH_TSV_SQL, persisted=True),
        ),
        sa.Column("source_version", sa.Integer(), nullable=True),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "entity_type IN ('ARTIST','BAND','RELEASE','TRACK','EVENT','VENUE',"
            "'CAMPAIGN','USER','ORGANIZATION')",
            name="ck_search_documents_entity_type",
        ),
        sa.CheckConstraint(
            "visibility IN ('PUBLIC','STAFF_ORG','UNAVAILABLE')",
            name="ck_search_documents_visibility",
        ),
        sa.UniqueConstraint("entity_type", "entity_id", name="uq_search_documents_entity"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_search_documents_organization_id_organizations",
        ),
        schema="search",
    )
    op.create_index(
        "ix_search_documents_organization_id",
        "search_documents",
        ["organization_id"],
        schema="search",
    )
    op.create_index(
        "ix_search_documents_visibility",
        "search_documents",
        ["visibility"],
        schema="search",
    )
    op.create_index(
        "ix_search_documents_entity_type",
        "search_documents",
        ["entity_type"],
        schema="search",
    )
    op.create_index(
        "ix_search_documents_tsv",
        "search_documents",
        ["tsv"],
        schema="search",
        postgresql_using="gin",
    )
    op.create_index(
        "ix_search_documents_title_trgm",
        "search_documents",
        ["title"],
        schema="search",
        postgresql_using="gin",
        postgresql_ops={"title": "gin_trgm_ops"},
    )
    op.execute(
        sa.text(
            "COMMENT ON TABLE search.search_documents IS "
            "'Rebuildable FTS+trigram projection. Not catalog/event/money truth. "
            "Guest visibility is application policy; schema default UNAVAILABLE does not force PUBLIC.'"
        )
    )

    # --- analytics facts (append-only) + empty daily projections ---
    op.create_table(
        "analytics_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("consumer", sa.String(64), nullable=False),
        sa.Column("event_type", sa.String(128), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source_module", sa.String(64), nullable=True),
        sa.Column("source_entity_type", sa.String(64), nullable=True),
        sa.Column("source_entity_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("correlation_id", sa.String(128), nullable=True),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "properties",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.UniqueConstraint(
            "source_event_id",
            "consumer",
            name="uq_analytics_events_source_consumer",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_analytics_events_organization_id_organizations",
        ),
        schema="analytics",
    )
    op.create_index(
        "ix_analytics_events_occurred_at",
        "analytics_events",
        ["occurred_at"],
        schema="analytics",
    )
    op.create_index(
        "ix_analytics_events_organization_id",
        "analytics_events",
        ["organization_id"],
        schema="analytics",
    )
    op.create_index(
        "ix_analytics_events_event_type",
        "analytics_events",
        ["event_type"],
        schema="analytics",
    )
    op.create_index(
        "ix_analytics_events_source_entity",
        "analytics_events",
        ["source_entity_type", "source_entity_id"],
        schema="analytics",
    )
    op.create_index(
        "ix_analytics_events_correlation_id",
        "analytics_events",
        ["correlation_id"],
        schema="analytics",
    )
    op.execute(
        sa.text(
            "COMMENT ON TABLE analytics.analytics_events IS "
            "'Append-only ingest from outbox. source_event_id matches DomainEvent.event_id / "
            "infra.outbox_events.id. Not a ledger, not audit_log, not playback_events. "
            "JSONB properties are flexible payload only — no passwords, secrets, KYC, or money-as-truth.'"
        )
    )

    op.create_table(
        "daily_track_metrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("metric_date", sa.Date(), nullable=False),
        sa.Column("track_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("metric_definition_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("play_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("completed_play_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("listen_duration_ms", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("play_count >= 0", name="ck_daily_track_metrics_play_count"),
        sa.CheckConstraint("completed_play_count >= 0", name="ck_daily_track_metrics_completed_play_count"),
        sa.CheckConstraint("listen_duration_ms >= 0", name="ck_daily_track_metrics_listen_duration_ms"),
        sa.UniqueConstraint(
            "metric_date",
            "track_id",
            "metric_definition_version",
            name="uq_daily_track_metrics_date_track_version",
        ),
        schema="analytics",
    )
    op.create_index(
        "ix_daily_track_metrics_organization_id",
        "daily_track_metrics",
        ["organization_id"],
        schema="analytics",
    )
    op.create_index(
        "ix_daily_track_metrics_metric_date",
        "daily_track_metrics",
        ["metric_date"],
        schema="analytics",
    )
    op.execute(
        sa.text(
            "COMMENT ON TABLE analytics.daily_track_metrics IS "
            "'Empty incremental projection. metric_date = calendar date in ASSUMED timezone "
            "Asia/Dhaka (09_ §2); store source occurred_at in UTC on analytics_events. "
            "play_count is ingested TrackPlayed facts, not unique listeners. "
            "No unique_listeners or activation columns (Q-P13-16 / Q-P1-25 OPEN).'"
        )
    )

    op.create_table(
        "daily_event_metrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("metric_date", sa.Date(), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("metric_definition_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("ticket_paid_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("ticket_issued_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("ticket_checked_in_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("ticket_paid_count >= 0", name="ck_daily_event_metrics_ticket_paid_count"),
        sa.CheckConstraint("ticket_issued_count >= 0", name="ck_daily_event_metrics_ticket_issued_count"),
        sa.CheckConstraint(
            "ticket_checked_in_count >= 0",
            name="ck_daily_event_metrics_ticket_checked_in_count",
        ),
        sa.UniqueConstraint(
            "metric_date",
            "event_id",
            "metric_definition_version",
            name="uq_daily_event_metrics_date_event_version",
        ),
        schema="analytics",
    )
    op.create_index(
        "ix_daily_event_metrics_organization_id",
        "daily_event_metrics",
        ["organization_id"],
        schema="analytics",
    )
    op.create_index(
        "ix_daily_event_metrics_metric_date",
        "daily_event_metrics",
        ["metric_date"],
        schema="analytics",
    )
    op.execute(
        sa.text(
            "COMMENT ON TABLE analytics.daily_event_metrics IS "
            "'Empty incremental projection. metric_date ASSUMED Asia/Dhaka (09_ §2). "
            "Counts are ingested facts, not remaining inventory or door truth.'"
        )
    )

    op.create_table(
        "daily_campaign_metrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("metric_date", sa.Date(), nullable=False),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("metric_definition_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("ingested_event_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "ingested_event_count >= 0",
            name="ck_daily_campaign_metrics_ingested_event_count",
        ),
        sa.UniqueConstraint(
            "metric_date",
            "campaign_id",
            "metric_definition_version",
            name="uq_daily_campaign_metrics_date_campaign_version",
        ),
        schema="analytics",
    )
    op.create_index(
        "ix_daily_campaign_metrics_organization_id",
        "daily_campaign_metrics",
        ["organization_id"],
        schema="analytics",
    )
    op.create_index(
        "ix_daily_campaign_metrics_metric_date",
        "daily_campaign_metrics",
        ["metric_date"],
        schema="analytics",
    )
    op.execute(
        sa.text(
            "COMMENT ON TABLE analytics.daily_campaign_metrics IS "
            "'Empty incremental projection. metric_date ASSUMED Asia/Dhaka (09_ §2). "
            "No CAC/ROAS/attribution/spend columns. Actuals remain ATTRIBUTION_UNDEFINED (Q-P12-09).'"
        )
    )


def downgrade() -> None:
    op.drop_index(
        "ix_daily_campaign_metrics_metric_date",
        table_name="daily_campaign_metrics",
        schema="analytics",
    )
    op.drop_index(
        "ix_daily_campaign_metrics_organization_id",
        table_name="daily_campaign_metrics",
        schema="analytics",
    )
    op.drop_table("daily_campaign_metrics", schema="analytics")
    op.drop_index(
        "ix_daily_event_metrics_metric_date",
        table_name="daily_event_metrics",
        schema="analytics",
    )
    op.drop_index(
        "ix_daily_event_metrics_organization_id",
        table_name="daily_event_metrics",
        schema="analytics",
    )
    op.drop_table("daily_event_metrics", schema="analytics")
    op.drop_index(
        "ix_daily_track_metrics_metric_date",
        table_name="daily_track_metrics",
        schema="analytics",
    )
    op.drop_index(
        "ix_daily_track_metrics_organization_id",
        table_name="daily_track_metrics",
        schema="analytics",
    )
    op.drop_table("daily_track_metrics", schema="analytics")
    op.drop_index("ix_analytics_events_correlation_id", table_name="analytics_events", schema="analytics")
    op.drop_index("ix_analytics_events_source_entity", table_name="analytics_events", schema="analytics")
    op.drop_index("ix_analytics_events_event_type", table_name="analytics_events", schema="analytics")
    op.drop_index("ix_analytics_events_organization_id", table_name="analytics_events", schema="analytics")
    op.drop_index("ix_analytics_events_occurred_at", table_name="analytics_events", schema="analytics")
    op.drop_table("analytics_events", schema="analytics")
    op.execute(sa.text("DROP SCHEMA IF EXISTS analytics"))

    op.drop_index("ix_search_documents_title_trgm", table_name="search_documents", schema="search")
    op.drop_index("ix_search_documents_tsv", table_name="search_documents", schema="search")
    op.drop_index("ix_search_documents_entity_type", table_name="search_documents", schema="search")
    op.drop_index("ix_search_documents_visibility", table_name="search_documents", schema="search")
    op.drop_index("ix_search_documents_organization_id", table_name="search_documents", schema="search")
    op.drop_table("search_documents", schema="search")
    op.execute(sa.text("DROP SCHEMA IF EXISTS search"))

    op.drop_constraint(
        "ck_notification_preferences_quiet_hours_pair",
        "notification_preferences",
        schema="notifications",
        type_="check",
    )
    op.drop_column("notification_preferences", "quiet_hours_timezone", schema="notifications")
    op.drop_column("notification_preferences", "quiet_hours_end", schema="notifications")
    op.drop_column("notification_preferences", "quiet_hours_start", schema="notifications")

    op.drop_index(
        "ix_notification_deliveries_notification_id",
        table_name="notification_deliveries",
        schema="notifications",
    )
    op.drop_index(
        "ix_notification_deliveries_status_next_attempt",
        table_name="notification_deliveries",
        schema="notifications",
    )
    op.drop_constraint(
        "ck_notification_deliveries_status",
        "notification_deliveries",
        schema="notifications",
        type_="check",
    )
    op.drop_column("notification_deliveries", "provider_code", schema="notifications")
    op.drop_column("notification_deliveries", "last_error", schema="notifications")
    op.drop_column("notification_deliveries", "next_attempt_at", schema="notifications")

    op.drop_index("uq_notifications_ingest_idempotency", table_name="notifications", schema="notifications")
    op.drop_index("ix_notifications_correlation_id", table_name="notifications", schema="notifications")
    op.drop_index("ix_notifications_organization_id", table_name="notifications", schema="notifications")
    op.drop_index("ix_notifications_user_status_created", table_name="notifications", schema="notifications")
    op.drop_constraint(
        "ck_notifications_ingest_pair",
        "notifications",
        schema="notifications",
        type_="check",
    )
    op.drop_constraint(
        "ck_notifications_category",
        "notifications",
        schema="notifications",
        type_="check",
    )
    op.drop_constraint(
        "ck_notifications_status",
        "notifications",
        schema="notifications",
        type_="check",
    )
    op.drop_constraint(
        "fk_notifications_organization_id_organizations",
        "notifications",
        schema="notifications",
        type_="foreignkey",
    )
    op.drop_column("notifications", "source_event_id", schema="notifications")
    op.drop_column("notifications", "consumer", schema="notifications")
    op.drop_column("notifications", "category", schema="notifications")
    op.drop_column("notifications", "organization_id", schema="notifications")
    op.drop_column("notifications", "correlation_id", schema="notifications")
    # pg_trgm is left installed; it may pre-exist or be reused.
