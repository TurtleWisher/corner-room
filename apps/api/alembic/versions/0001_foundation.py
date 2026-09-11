"""Phase 0 platform foundation tables.

Revision ID: 0001_foundation
Revises:
Create Date: 2026-09-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_foundation"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMAS = ("identity", "permissions", "audit", "notifications", "documents", "infra")


def upgrade() -> None:
    for schema in SCHEMAS:
        op.execute(sa.text(f"CREATE SCHEMA IF NOT EXISTS {schema}"))

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING_VERIFICATION"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('PENDING_VERIFICATION','ACTIVE','SUSPENDED','CLOSED')",
            name="ck_users_status",
        ),
        schema="identity",
    )
    op.create_index("ix_users_status", "users", ["status"], schema="identity")
    op.create_index(
        "uq_users_email_active",
        "users",
        ["email"],
        unique=True,
        schema="identity",
        postgresql_where=sa.text("email IS NOT NULL AND deleted_at IS NULL"),
    )
    op.create_index(
        "uq_users_phone_active",
        "users",
        ["phone"],
        unique=True,
        schema="identity",
        postgresql_where=sa.text("phone IS NOT NULL AND deleted_at IS NULL"),
    )

    op.create_table(
        "customer_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("locale", sa.String(8), nullable=False, server_default="en"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["identity.users.id"], name="fk_customer_profiles_user_id_users"),
        sa.UniqueConstraint("user_id", name="uq_customer_profiles_user_id"),
        sa.CheckConstraint("status IN ('ACTIVE','HIDDEN')", name="ck_customer_profiles_status"),
        sa.CheckConstraint("locale IN ('en','bn')", name="ck_customer_profiles_locale"),
        schema="identity",
    )

    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("share_bps", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "type IN ('PLATFORM','LABEL','EVENT_ORG','VENUE_PARTNER','SPONSOR','AGENCY')",
            name="ck_organizations_type",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING','ACTIVE','SUSPENDED','ARCHIVED')",
            name="ck_organizations_status",
        ),
        sa.CheckConstraint(
            "share_bps IS NULL OR (share_bps >= 0 AND share_bps <= 10000)",
            name="ck_organizations_share_bps",
        ),
        schema="identity",
    )
    op.create_index("ix_organizations_status", "organizations", ["status"], schema="identity")

    op.create_table(
        "organization_memberships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="INVITED"),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["identity.organizations.id"],
            name="fk_organization_memberships_organization_id_organizations",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["identity.users.id"],
            name="fk_organization_memberships_user_id_users",
        ),
        sa.CheckConstraint("status IN ('INVITED','ACTIVE','REVOKED')", name="ck_organization_memberships_status"),
        schema="identity",
    )
    op.create_index(
        "uq_org_memberships_active",
        "organization_memberships",
        ["organization_id", "user_id"],
        unique=True,
        schema="identity",
        postgresql_where=sa.text("status = 'ACTIVE' AND deleted_at IS NULL"),
    )
    op.create_index(
        "ix_org_memberships_user_status",
        "organization_memberships",
        ["user_id", "status"],
        schema="identity",
    )

    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("refresh_token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("rotated_from_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["identity.users.id"], name="fk_sessions_user_id_users"),
        schema="identity",
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"], schema="identity")
    op.create_index("ix_sessions_expires_at", "sessions", ["expires_at"], schema="identity")
    op.create_index(
        "ix_sessions_refresh_hash",
        "sessions",
        ["refresh_token_hash"],
        unique=True,
        schema="identity",
    )

    op.create_table(
        "roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('ACTIVE','RETIRED')", name="ck_roles_status"),
        schema="permissions",
    )
    op.create_index("uq_roles_key", "roles", ["key"], unique=True, schema="permissions")

    op.create_table(
        "permissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        schema="permissions",
    )
    op.create_index("uq_permissions_key", "permissions", ["key"], unique=True, schema="permissions")

    op.create_table(
        "role_permissions",
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("permission_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["permissions.roles.id"], name="fk_role_permissions_role_id_roles"),
        sa.ForeignKeyConstraint(
            ["permission_id"],
            ["permissions.permissions.id"],
            name="fk_role_permissions_permission_id_permissions",
        ),
        sa.PrimaryKeyConstraint("role_id", "permission_id", name="pk_role_permissions"),
        schema="permissions",
    )

    op.create_table(
        "role_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["role_id"], ["permissions.roles.id"], name="fk_role_assignments_role_id_roles"),
        sa.ForeignKeyConstraint(["user_id"], ["identity.users.id"], name="fk_role_assignments_user_id_users"),
        sa.CheckConstraint("status IN ('ACTIVE','REVOKED')", name="ck_role_assignments_status"),
        schema="permissions",
    )
    op.create_index(
        "ix_role_assignments_user_status",
        "role_assignments",
        ["user_id", "status"],
        schema="permissions",
    )

    op.create_table(
        "resource_grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("principal_type", sa.String(32), nullable=False),
        sa.Column("principal_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("permission_key", sa.String(64), nullable=False),
        sa.Column("resource_type", sa.String(64), nullable=False),
        sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('ACTIVE','REVOKED')", name="ck_resource_grants_status"),
        sa.CheckConstraint(
            "principal_type IN ('user','role','org_membership')",
            name="ck_resource_grants_principal_type",
        ),
        schema="permissions",
    )
    op.create_index(
        "uq_resource_grants_active",
        "resource_grants",
        ["principal_type", "principal_id", "permission_key", "resource_type", "resource_id"],
        unique=True,
        schema="permissions",
        postgresql_where=sa.text("status = 'ACTIVE' AND deleted_at IS NULL"),
    )
    op.create_index(
        "ix_resource_grants_resource",
        "resource_grants",
        ["resource_type", "resource_id"],
        schema="permissions",
    )
    op.create_index(
        "ix_resource_grants_principal_status",
        "resource_grants",
        ["principal_id", "status"],
        schema="permissions",
    )

    op.create_table(
        "audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("actor_id", sa.String(64), nullable=False),
        sa.Column("actor_type", sa.String(32), nullable=False, server_default="user"),
        sa.Column("on_behalf_of_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("previous_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("new_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        schema="audit",
    )
    op.create_index(
        "ix_audit_log_entity",
        "audit_log",
        ["entity_type", "entity_id", "occurred_at"],
        schema="audit",
    )
    op.create_index("ix_audit_log_actor", "audit_log", ["actor_id", "occurred_at"], schema="audit")
    op.create_index("ix_audit_log_occurred_at", "audit_log", ["occurred_at"], schema="audit")

    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="UNREAD"),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("locale", sa.String(8), nullable=False, server_default="en"),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("aggregate_type", sa.String(64), nullable=True),
        sa.Column("aggregate_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        schema="notifications",
    )
    op.create_table(
        "notification_deliveries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("notification_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("provider_ref", sa.String(128), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["notification_id"],
            ["notifications.notifications.id"],
            name="fk_notification_deliveries_notification_id_notifications",
        ),
        schema="notifications",
    )
    op.create_table(
        "notification_preferences",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("notification_type", sa.String(64), nullable=False),
        sa.Column("in_app", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("email", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("push", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sms", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "notification_type", name="pk_notification_preferences"),
        schema="notifications",
    )
    op.create_table(
        "notification_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("locale", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        schema="notifications",
    )

    op.create_table(
        "media_assets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("class", sa.String(64), nullable=False),
        sa.Column("bucket", sa.String(128), nullable=False),
        sa.Column("object_key", sa.String(512), nullable=False),
        sa.Column("mime", sa.String(128), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("scan_status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("legal_hold", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        schema="documents",
    )
    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("type", sa.String(64), nullable=False),
        sa.Column("owner_type", sa.String(64), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="UPLOADING"),
        sa.Column("legal_hold", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("retention_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        schema="documents",
    )
    op.create_table(
        "document_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("media_asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.documents.id"],
            name="fk_document_versions_document_id_documents",
        ),
        sa.ForeignKeyConstraint(
            ["media_asset_id"],
            ["documents.media_assets.id"],
            name="fk_document_versions_media_asset_id_media_assets",
        ),
        sa.UniqueConstraint("document_id", "version", name="uq_document_versions_doc_version"),
        schema="documents",
    )
    op.create_table(
        "document_acl",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("principal_type", sa.String(32), nullable=False),
        sa.Column("principal_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("access", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.documents.id"],
            name="fk_document_acl_document_id_documents",
        ),
        schema="documents",
    )

    op.create_table(
        "outbox_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_type", sa.String(128), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        schema="infra",
    )
    op.create_index(
        "ix_outbox_events_status_created",
        "outbox_events",
        ["status", "created_at"],
        schema="infra",
    )
    op.create_table(
        "idempotency_records",
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response_code", sa.Integer(), nullable=False),
        sa.Column("response_body", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        schema="infra",
    )


def downgrade() -> None:
    op.drop_table("idempotency_records", schema="infra")
    op.drop_table("outbox_events", schema="infra")
    op.drop_table("document_acl", schema="documents")
    op.drop_table("document_versions", schema="documents")
    op.drop_table("documents", schema="documents")
    op.drop_table("media_assets", schema="documents")
    op.drop_table("notification_templates", schema="notifications")
    op.drop_table("notification_preferences", schema="notifications")
    op.drop_table("notification_deliveries", schema="notifications")
    op.drop_table("notifications", schema="notifications")
    op.drop_table("audit_log", schema="audit")
    op.drop_table("resource_grants", schema="permissions")
    op.drop_table("role_assignments", schema="permissions")
    op.drop_table("role_permissions", schema="permissions")
    op.drop_table("permissions", schema="permissions")
    op.drop_table("roles", schema="permissions")
    op.drop_table("sessions", schema="identity")
    op.drop_table("organization_memberships", schema="identity")
    op.drop_table("organizations", schema="identity")
    op.drop_table("customer_profiles", schema="identity")
    op.drop_table("users", schema="identity")
    for schema in SCHEMAS:
        op.execute(sa.text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
