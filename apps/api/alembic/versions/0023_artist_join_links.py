"""Artist join links: a label's shared link for artists to join and apply. Additive only.

Revision ID: 0023_artist_join_links
Revises: 0022_downloads
Create Date: 2026-10-17

Owner, 2026-10-17: artists join through a shared link (one link, many artists, switched off or
replaced at will) and staff still review every application. Applications record the link and the
label they came through, so approval places the artist in that label.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023_artist_join_links"
down_revision: Union[str, Sequence[str], None] = "0022_downloads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "artist_join_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("identity.organizations.id"), nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="ACTIVE"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("uses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.CheckConstraint("status IN ('ACTIVE','DISABLED')", name="ck_artist_join_links_status"),
        sa.CheckConstraint("max_uses IS NULL OR max_uses > 0", name="ck_artist_join_links_max_uses"),
        sa.CheckConstraint("uses >= 0", name="ck_artist_join_links_uses"),
        sa.UniqueConstraint("code", name="uq_artist_join_links_code"),
        schema="artists",
    )
    op.create_index("ix_artist_join_links_organization_id", "artist_join_links", ["organization_id"], schema="artists")
    op.add_column(
        "artist_applications",
        sa.Column("join_link_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("artists.artist_join_links.id"), nullable=True),
        schema="artists",
    )
    op.add_column(
        "artist_applications",
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("identity.organizations.id"), nullable=True),
        schema="artists",
    )


def downgrade() -> None:
    op.drop_column("artist_applications", "organization_id", schema="artists")
    op.drop_column("artist_applications", "join_link_id", schema="artists")
    op.drop_index("ix_artist_join_links_organization_id", table_name="artist_join_links", schema="artists")
    op.drop_table("artist_join_links", schema="artists")
