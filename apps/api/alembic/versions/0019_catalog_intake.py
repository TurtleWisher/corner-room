"""Audio platform Phase 4/5: release details, credit vocabulary, staff intake, price proposals.

Revision ID: 0019_catalog_intake
Revises: 0018_media_processing
Create Date: 2026-10-17

Design: docs/phases/AUDIO_PHASE_1_DESIGN.md sections 4.1, 4.3 (offer_proposals moved here from
0020 because the artist Studio proposes prices in Phase 4). New nullable or defaulted columns,
new tables, and one widened check (credits may name a non-performer by typed name, D-AUDIO-16).
Lookup rows (genres, credit roles) are seeded by the application seed.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0019_catalog_intake"
down_revision: Union[str, Sequence[str], None] = "0018_media_processing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _ts() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "genres",
        sa.Column("key", sa.String(48), nullable=False),
        sa.Column("label_en", sa.String(80), nullable=False),
        sa.Column("label_bn", sa.String(80), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("key", name="pk_genres"),
        sa.CheckConstraint("status IN ('ACTIVE','RETIRED')", name="ck_genres_status"),
        schema="music",
    )
    op.create_table(
        "credit_roles",
        sa.Column("key", sa.String(32), nullable=False),
        sa.Column("label_en", sa.String(80), nullable=False),
        sa.Column("label_bn", sa.String(80), nullable=True),
        sa.Column("performer", sa.Boolean(), nullable=False),
        sa.Column("allows_instrument", sa.Boolean(), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("key", name="pk_credit_roles"),
        schema="music",
    )

    release_cols = [
        sa.Column("language_code", sa.String(16), nullable=True),
        sa.Column("genre_primary", sa.String(48), nullable=True),
        sa.Column("genre_secondary", sa.String(48), nullable=True),
        sa.Column("label_name", sa.String(200), nullable=True),
        sa.Column("p_line", sa.String(300), nullable=True),
        sa.Column("c_line", sa.String(300), nullable=True),
        sa.Column("release_timezone", sa.String(64), nullable=False, server_default="Asia/Dhaka"),
        sa.Column("upc", sa.String(14), nullable=True),
        sa.Column("track_sales", sa.String(24), nullable=False, server_default="RELEASE_ONLY"),
        sa.Column("intake_mode", sa.String(16), nullable=False, server_default="SELF"),
        sa.Column("rights_declared_by", UUID, nullable=True),
        sa.Column("rights_declared_at", sa.DateTime(timezone=True), nullable=True),
    ]
    for col in release_cols:
        op.add_column("releases", col, schema="music")
    op.create_foreign_key("fk_releases_genre_primary_genres", "releases", "genres", ["genre_primary"], ["key"], source_schema="music", referent_schema="music")
    op.create_foreign_key("fk_releases_genre_secondary_genres", "releases", "genres", ["genre_secondary"], ["key"], source_schema="music", referent_schema="music")
    op.create_check_constraint("ck_releases_track_sales", "releases", "track_sales IN ('RELEASE_ONLY','TRACKS_ALLOWED')", schema="music")
    op.create_check_constraint("ck_releases_intake_mode", "releases", "intake_mode IN ('SELF','ASSISTED','MANAGED')", schema="music")
    op.create_index("uq_releases_upc", "releases", ["upc"], unique=True, schema="music", postgresql_where=sa.text("upc IS NOT NULL AND deleted_at IS NULL"))

    track_cols = [
        sa.Column("explicit", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("language_code", sa.String(16), nullable=True),
        sa.Column("version_title", sa.String(100), nullable=True),
        sa.Column("genre_primary", sa.String(48), nullable=True),
        sa.Column("genre_secondary", sa.String(48), nullable=True),
    ]
    for col in track_cols:
        op.add_column("tracks", col, schema="music")
    op.create_foreign_key("fk_tracks_genre_primary_genres", "tracks", "genres", ["genre_primary"], ["key"], source_schema="music", referent_schema="music")
    op.create_foreign_key("fk_tracks_genre_secondary_genres", "tracks", "genres", ["genre_secondary"], ["key"], source_schema="music", referent_schema="music")

    for col in (
        sa.Column("role_key", sa.String(32), nullable=True),
        sa.Column("display_name", sa.String(200), nullable=True),
        sa.Column("instrument", sa.String(80), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    ):
        op.add_column("credits", col, schema="music")
    op.create_foreign_key("fk_credits_role_key_credit_roles", "credits", "credit_roles", ["role_key"], ["key"], source_schema="music", referent_schema="music")
    op.drop_constraint("ck_credits_credit_party", "credits", schema="music", type_="check")
    op.create_check_constraint(
        "ck_credits_credit_party",
        "credits",
        "artist_id IS NOT NULL OR user_id IS NOT NULL OR display_name IS NOT NULL",
        schema="music",
    )

    op.create_table(
        "release_contributors",
        sa.Column("release_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("first_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("release_id", "user_id", "role", name="pk_release_contributors"),
        sa.ForeignKeyConstraint(["release_id"], ["music.releases.id"], name="fk_release_contributors_release_id_releases"),
        sa.CheckConstraint("role IN ('PREPARER')", name="ck_release_contributors_role"),
        schema="music",
    )
    op.create_table(
        "intake_records",
        sa.Column("id", UUID, nullable=False),
        sa.Column("release_id", UUID, nullable=False),
        sa.Column("profile_type", sa.String(8), nullable=False),
        sa.Column("profile_id", UUID, nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("opened_by", UUID, nullable=False),
        sa.Column("managed_enabled_by", UUID, nullable=True),
        sa.Column("managed_reason", sa.Text(), nullable=True),
        sa.Column("managed_enabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("artist_confirmed_by", UUID, nullable=True),
        sa.Column("artist_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        *_ts(),
        sa.PrimaryKeyConstraint("id", name="pk_intake_records"),
        sa.ForeignKeyConstraint(["release_id"], ["music.releases.id"], name="fk_intake_records_release_id_releases"),
        sa.UniqueConstraint("release_id", name="uq_intake_records_release_id"),
        sa.CheckConstraint("mode IN ('ASSISTED','MANAGED')", name="ck_intake_records_mode"),
        sa.CheckConstraint("status IN ('OPEN','CONFIRMED','CLOSED')", name="ck_intake_records_status"),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_intake_records_profile_type"),
        schema="music",
    )
    op.create_table(
        "offer_proposals",
        sa.Column("id", UUID, nullable=False),
        sa.Column("release_id", UUID, nullable=False),
        sa.Column("subject_type", sa.String(16), nullable=False),
        sa.Column("subject_id", UUID, nullable=False),
        sa.Column("audience", sa.String(24), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency_code", sa.String(3), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("proposed_by", UUID, nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("decided_by", UUID, nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.String(500), nullable=True),
        sa.Column("resulting_offer_id", UUID, nullable=True),
        *_ts(),
        sa.PrimaryKeyConstraint("id", name="pk_offer_proposals"),
        sa.CheckConstraint("subject_type IN ('TRACK','RELEASE')", name="ck_offer_proposals_subject_type"),
        sa.CheckConstraint("audience IN ('EVERYONE','OWNS_PART_OF_RELEASE')", name="ck_offer_proposals_audience"),
        sa.CheckConstraint("status IN ('PROPOSED','ACCEPTED','COUNTERED','WITHDRAWN')", name="ck_offer_proposals_status"),
        sa.CheckConstraint("amount_minor >= 0", name="ck_offer_proposals_amount_non_negative"),
        schema="commerce",
    )
    op.create_index("ix_offer_proposals_subject", "offer_proposals", ["subject_type", "subject_id"], schema="commerce")
    op.create_index("ix_offer_proposals_status", "offer_proposals", ["status"], schema="commerce")


def downgrade() -> None:
    op.drop_index("ix_offer_proposals_status", table_name="offer_proposals", schema="commerce")
    op.drop_index("ix_offer_proposals_subject", table_name="offer_proposals", schema="commerce")
    op.drop_table("offer_proposals", schema="commerce")
    op.drop_table("intake_records", schema="music")
    op.drop_table("release_contributors", schema="music")
    # Typed-name credits cannot satisfy the old check; remove them before narrowing it back.
    op.execute("DELETE FROM music.credits WHERE artist_id IS NULL AND user_id IS NULL")
    op.drop_constraint("ck_credits_credit_party", "credits", schema="music", type_="check")
    op.create_check_constraint("ck_credits_credit_party", "credits", "artist_id IS NOT NULL OR user_id IS NOT NULL", schema="music")
    op.drop_constraint("fk_credits_role_key_credit_roles", "credits", schema="music", type_="foreignkey")
    for col in ("position", "instrument", "display_name", "role_key"):
        op.drop_column("credits", col, schema="music")
    op.drop_constraint("fk_tracks_genre_secondary_genres", "tracks", schema="music", type_="foreignkey")
    op.drop_constraint("fk_tracks_genre_primary_genres", "tracks", schema="music", type_="foreignkey")
    for col in ("genre_secondary", "genre_primary", "version_title", "language_code", "explicit"):
        op.drop_column("tracks", col, schema="music")
    op.drop_index("uq_releases_upc", table_name="releases", schema="music")
    op.drop_constraint("ck_releases_intake_mode", "releases", schema="music", type_="check")
    op.drop_constraint("ck_releases_track_sales", "releases", schema="music", type_="check")
    op.drop_constraint("fk_releases_genre_secondary_genres", "releases", schema="music", type_="foreignkey")
    op.drop_constraint("fk_releases_genre_primary_genres", "releases", schema="music", type_="foreignkey")
    for col in (
        "rights_declared_at", "rights_declared_by", "intake_mode", "track_sales", "upc", "release_timezone",
        "c_line", "p_line", "label_name", "genre_secondary", "genre_primary", "language_code",
    ):
        op.drop_column("releases", col, schema="music")
    op.drop_table("credit_roles", schema="music")
    op.drop_table("genres", schema="music")
