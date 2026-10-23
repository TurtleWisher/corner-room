"""Profile pictures and artist profile changes reviewed by staff. Additive only.

Revision ID: 0029_profile_pictures
Revises: 0028_event_cover
Create Date: 2026-10-23

Owner, 2026-10-23: fans and artists edit their own profile and picture. Pictures are square JPEG or
PNG of at least 400 px (cropped to a square in the browser). A fan's picture is theirs at once; an
artist's or band's new name, bio or picture waits for staff approval before the public sees it.

`identity.customer_profiles.avatar_asset_id` is the fan's picture; uploads may now target a fan's
own account, an artist or a band; `artists.profile_change_requests` holds what an artist or band
admin asked to change until staff approve or reject it (one waiting request per profile).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0029_profile_pictures"
down_revision: Union[str, Sequence[str], None] = "0028_event_cover"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TARGETS_BEFORE = "target_type IN ('track_version','release_cover','event_cover')"
TARGETS_AFTER = (
    "target_type IN ('track_version','release_cover','event_cover','user_avatar','artist_portrait','band_portrait')"
)


def upgrade() -> None:
    op.add_column(
        "customer_profiles",
        sa.Column(
            "avatar_asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.media_assets.id", name="fk_customer_profiles_avatar_asset_id_media_assets"),
            nullable=True,
        ),
        schema="identity",
    )
    op.drop_constraint("ck_upload_intents_target_type", "upload_intents", schema="documents", type_="check")
    op.create_check_constraint(op.f("ck_upload_intents_target_type"), "upload_intents", TARGETS_AFTER, schema="documents")
    op.create_table(
        "profile_change_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("profile_type", sa.String(16), nullable=False),
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("identity.organizations.id"), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("stage_name", sa.String(200), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("bio_changed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("portrait_asset_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.media_assets.id"), nullable=True),
        sa.Column("remove_portrait", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("identity.users.id"), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_profile_change_requests_profile_type"),
        sa.CheckConstraint(
            "status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')", name="ck_profile_change_requests_status"
        ),
        schema="artists",
    )
    op.create_index(
        "ix_profile_change_requests_profile", "profile_change_requests", ["profile_type", "profile_id"], schema="artists"
    )
    op.create_index("ix_profile_change_requests_status", "profile_change_requests", ["status"], schema="artists")
    op.create_index(
        "uq_profile_change_requests_open",
        "profile_change_requests",
        ["profile_type", "profile_id"],
        unique=True,
        schema="artists",
        postgresql_where=sa.text("status = 'PENDING'"),
    )


def downgrade() -> None:
    op.drop_index("uq_profile_change_requests_open", table_name="profile_change_requests", schema="artists")
    op.drop_index("ix_profile_change_requests_status", table_name="profile_change_requests", schema="artists")
    op.drop_index("ix_profile_change_requests_profile", table_name="profile_change_requests", schema="artists")
    op.drop_table("profile_change_requests", schema="artists")
    op.drop_constraint("ck_upload_intents_target_type", "upload_intents", schema="documents", type_="check")
    op.create_check_constraint(op.f("ck_upload_intents_target_type"), "upload_intents", TARGETS_BEFORE, schema="documents")
    op.drop_column("customer_profiles", "avatar_asset_id", schema="identity")
