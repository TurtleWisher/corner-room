"""Music gifts: artists give songs and releases free to chosen people. Additive only.

Revision ID: 0050_music_gifts
Revises: 0049_presale_campaigns
Create Date: 2026-11-06

Owner, 2026-11-06 (D-GIFT-MUSIC-01): an artist or band gives chosen music free to chosen email
addresses, with no payment pages. Staff approve each gift. `commerce.music_gifts` holds the gift
(music, email, files, sending time), `commerce.music_gift_recipients` one row per person. A person
with an account gets a ৳0 order (`commerce.orders.music_gift_id`), so they own it like a purchase
and no money moves; the email goes through the artist-email pipeline as kind GIFT.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0050_music_gifts"
down_revision: Union[str, Sequence[str], None] = "0049_presale_campaigns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB()


def upgrade() -> None:
    op.create_table(
        "music_gifts",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("profile_type", sa.String(8), nullable=False),
        sa.Column("profile_id", UUID, nullable=False),
        sa.Column("organization_id", UUID, sa.ForeignKey("identity.organizations.id"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("works", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("file_ids", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("send_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("submitted_by", UUID, nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", UUID, nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_music_gifts_profile_type"),
        sa.CheckConstraint("status IN ('DRAFT','IN_REVIEW','SCHEDULED','SENT')", name="ck_music_gifts_status"),
        schema="commerce",
    )
    op.create_index("ix_music_gifts_profile", "music_gifts", ["profile_type", "profile_id"], schema="commerce")
    op.create_index("ix_music_gifts_status", "music_gifts", ["organization_id", "status"], schema="commerce")

    op.create_table(
        "music_gift_recipients",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("gift_id", UUID, sa.ForeignKey("commerce.music_gifts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(200), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="WAITING"),
        sa.Column("user_id", UUID, sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("order_id", UUID, sa.ForeignKey("commerce.orders.id"), nullable=True),
        sa.Column("message_id", UUID, nullable=True),
        sa.Column("given_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint(
            "status IN ('WAITING','GIVEN','WAITING_ACCOUNT','ALREADY_OWNED')", name="ck_music_gift_recipients_status"
        ),
        sa.UniqueConstraint("gift_id", "email", name="uq_music_gift_recipients_email"),
        schema="commerce",
    )
    op.create_index(
        "ix_music_gift_recipients_email_status", "music_gift_recipients", ["email", "status"], schema="commerce"
    )

    op.add_column(
        "orders",
        sa.Column("music_gift_id", UUID, sa.ForeignKey("commerce.music_gifts.id"), nullable=True),
        schema="commerce",
    )
    op.add_column("artist_mail_messages", sa.Column("music_gift_id", UUID, nullable=True), schema="commerce")
    op.drop_constraint("ck_artist_mail_messages_kind", "artist_mail_messages", schema="commerce", type_="check")
    op.create_check_constraint(
        "ck_artist_mail_messages_kind", "artist_mail_messages", "kind IN ('THANK_YOU','MANUAL','TEST','GIFT')",
        schema="commerce",
    )


def downgrade() -> None:
    op.execute("DELETE FROM commerce.artist_mail_messages WHERE kind = 'GIFT'")
    op.drop_constraint("ck_artist_mail_messages_kind", "artist_mail_messages", schema="commerce", type_="check")
    op.create_check_constraint(
        "ck_artist_mail_messages_kind", "artist_mail_messages", "kind IN ('THANK_YOU','MANUAL','TEST')", schema="commerce"
    )
    op.drop_column("artist_mail_messages", "music_gift_id", schema="commerce")
    op.drop_column("orders", "music_gift_id", schema="commerce")
    op.drop_index("ix_music_gift_recipients_email_status", table_name="music_gift_recipients", schema="commerce")
    op.drop_table("music_gift_recipients", schema="commerce")
    op.drop_index("ix_music_gifts_status", table_name="music_gifts", schema="commerce")
    op.drop_index("ix_music_gifts_profile", table_name="music_gifts", schema="commerce")
    op.drop_table("music_gifts", schema="commerce")
