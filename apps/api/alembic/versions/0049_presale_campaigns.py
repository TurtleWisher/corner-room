"""Pre-sale campaigns: live counts and share links. Additive only.

Revision ID: 0049_presale_campaigns
Revises: 0048_early_presale
Create Date: 2026-11-06

Owner, 2026-11-06 (D-PRESALE-04): every pre-sale gets its own campaign pages in Studio with live
numbers that carry on into the release. `commerce.presale_counts` holds running totals per release
and hour (pages opened, Pre-book presses, where, which share link, which site), never single
visits. `commerce.presale_share_links` holds the links an artist makes to share the pre-sale.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0049_presale_campaigns"
down_revision: Union[str, Sequence[str], None] = "0048_early_presale"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "presale_counts",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("release_id", UUID, sa.ForeignKey("music.releases.id"), nullable=False),
        sa.Column("hour", sa.DateTime(timezone=True), nullable=False),
        sa.Column("phase", sa.String(10), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("place", sa.String(10), nullable=False, server_default=""),
        sa.Column("link_code", sa.String(16), nullable=False, server_default=""),
        sa.Column("referrer_host", sa.String(80), nullable=False, server_default=""),
        sa.Column("total", sa.BigInteger(), nullable=False, server_default="0"),
        sa.CheckConstraint("kind IN ('VIEW','PREBOOK')", name="ck_presale_counts_kind"),
        sa.CheckConstraint("phase IN ('PRESALE','RELEASED')", name="ck_presale_counts_phase"),
        sa.CheckConstraint("place IN ('','PAGE','STORE','HOME','RELEASES','PROFILE')", name="ck_presale_counts_place"),
        sa.CheckConstraint("total >= 0", name="ck_presale_counts_total_non_negative"),
        sa.UniqueConstraint(
            "release_id", "hour", "phase", "kind", "place", "link_code", "referrer_host", name="uq_presale_counts_bucket"
        ),
        schema="commerce",
    )
    op.create_index("ix_presale_counts_release_hour", "presale_counts", ["release_id", "hour"], schema="commerce")

    op.create_table(
        "presale_share_links",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("release_id", UUID, sa.ForeignKey("music.releases.id"), nullable=False),
        sa.Column("code", sa.String(16), nullable=False),
        sa.Column("label", sa.String(60), nullable=False),
        sa.Column("created_by", UUID, nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("code", name="uq_presale_share_links_code"),
        schema="commerce",
    )
    op.create_index("ix_presale_share_links_release", "presale_share_links", ["release_id"], schema="commerce")


def downgrade() -> None:
    op.drop_index("ix_presale_share_links_release", table_name="presale_share_links", schema="commerce")
    op.drop_table("presale_share_links", schema="commerce")
    op.drop_index("ix_presale_counts_release_hour", table_name="presale_counts", schema="commerce")
    op.drop_table("presale_counts", schema="commerce")
