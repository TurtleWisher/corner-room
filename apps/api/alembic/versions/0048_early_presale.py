"""Early pre-sale stage and the release-day email to pre-order buyers. Additive only.

Revision ID: 0048_early_presale
Revises: 0047_cover_reveal
Create Date: 2026-11-03

Owner, 2026-11-03 (D-PRESALE-03, option b): an artist can open a pre-sale from the normal release
editor before the audio or cover is ready. They propose a release date and a pre-sale price and send
the pre-sale for review; staff approve just the title, artist, date and price (`presale_status`
APPROVED), or send it back with a note. The release itself stays a draft and still goes through the
full review before release day. The artist can also write the email pre-order buyers get when the
release comes out; staff approve it like any artist email and it waits for the release
(`commerce.artist_mails.send_with_release_id`).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0048_early_presale"
down_revision: Union[str, Sequence[str], None] = "0047_cover_reveal"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
REVIEW_OLD = "action IN ('start_review','approve','request_changes','schedule','release','takedown','cancel_presale')"
REVIEW_NEW = (
    "action IN ('start_review','approve','request_changes','schedule','release','takedown','cancel_presale',"
    "'request_presale','approve_presale','return_presale','move_presale_date')"
)
EARLY_ACTIONS = "('request_presale','approve_presale','return_presale','move_presale_date')"


def upgrade() -> None:
    # Early pre-sale steps appear in the release's history like other review steps.
    op.drop_constraint("ck_release_reviews_action", "release_reviews", schema="music", type_="check")
    op.create_check_constraint(op.f("ck_release_reviews_action"), "release_reviews", REVIEW_NEW, schema="music")
    op.add_column("releases", sa.Column("presale_status", sa.String(16), nullable=True), schema="music")
    op.add_column("releases", sa.Column("presale_requested_at", sa.DateTime(timezone=True), nullable=True), schema="music")
    op.add_column("releases", sa.Column("presale_requested_by", UUID, nullable=True), schema="music")
    op.add_column("releases", sa.Column("presale_requested_release_at", sa.DateTime(timezone=True), nullable=True), schema="music")
    op.add_column("releases", sa.Column("presale_decided_at", sa.DateTime(timezone=True), nullable=True), schema="music")
    op.add_column("releases", sa.Column("presale_decided_by", UUID, nullable=True), schema="music")
    op.add_column("releases", sa.Column("presale_note", sa.Text(), nullable=True), schema="music")
    op.create_check_constraint(
        "ck_releases_presale_status", "releases",
        "presale_status IS NULL OR presale_status IN ('REQUESTED','APPROVED','RETURNED')", schema="music",
    )
    op.create_index(
        "ix_releases_presale_requested", "releases", ["primary_org_id"], schema="music",
        postgresql_where=sa.text("presale_status = 'REQUESTED'"),
    )
    op.add_column(
        "artist_mails",
        sa.Column("send_with_release_id", UUID, sa.ForeignKey("music.releases.id"), nullable=True),
        schema="commerce",
    )
    op.create_index(
        "ix_artist_mails_with_release", "artist_mails", ["send_with_release_id"], schema="commerce",
        postgresql_where=sa.text("send_with_release_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute(f"DELETE FROM music.release_reviews WHERE action IN {EARLY_ACTIONS}")
    op.drop_constraint("ck_release_reviews_action", "release_reviews", schema="music", type_="check")
    op.create_check_constraint(op.f("ck_release_reviews_action"), "release_reviews", REVIEW_OLD, schema="music")
    op.drop_index("ix_artist_mails_with_release", table_name="artist_mails", schema="commerce")
    op.drop_column("artist_mails", "send_with_release_id", schema="commerce")
    op.drop_index("ix_releases_presale_requested", table_name="releases", schema="music")
    op.drop_constraint("ck_releases_presale_status", "releases", schema="music", type_="check")
    for column in (
        "presale_note", "presale_decided_by", "presale_decided_at", "presale_requested_release_at",
        "presale_requested_by", "presale_requested_at", "presale_status",
    ):
        op.drop_column("releases", column, schema="music")
