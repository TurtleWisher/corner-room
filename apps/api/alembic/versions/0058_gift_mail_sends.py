"""One-off gift emails to picked buyers go to staff as one request. Additive only.

Revision ID: 0058_gift_mail_sends
Revises: 0057_story_sharing
Create Date: 2026-11-09

Owner, 2026-11-09 (D-CAMPAIGN-07): when an act emails buyers it picked about their gift, the words
and the people go to staff together. Nothing reaches a buyer until staff approve it and someone
presses Send. `artist_mail_messages.gift_send_id` ties each email sent to its request, for the
act's mail history.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0058_gift_mail_sends"
down_revision: Union[str, Sequence[str], None] = "0057_story_sharing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB
S = "commerce"


def upgrade() -> None:
    op.create_table(
        "gift_mail_sends",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("campaign_id", UUID, sa.ForeignKey("commerce.gift_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("button_label", sa.String(80), nullable=True),
        sa.Column("button_url", sa.String(2000), nullable=True),
        sa.Column("file_ids", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("recipient_ids", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("state", sa.String(16), nullable=False, server_default="IN_REVIEW"),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("updated_by", UUID, nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", UUID, nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_by", UUID, nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("purpose IN ('DISPATCHED','RETURNED','MISSING','OTHER')", name="ck_gift_mail_sends_purpose"),
        sa.CheckConstraint("state IN ('IN_REVIEW','RETURNED','APPROVED','SENT')", name="ck_gift_mail_sends_state"),
        schema=S,
    )
    op.create_index("ix_gift_mail_sends_campaign", "gift_mail_sends", ["campaign_id"], schema=S)
    op.create_index("ix_gift_mail_sends_state", "gift_mail_sends", ["state"], schema=S)
    op.add_column("artist_mail_messages", sa.Column("gift_send_id", UUID, nullable=True), schema=S)
    op.create_index("ix_artist_mail_messages_gift_send", "artist_mail_messages", ["gift_send_id"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_artist_mail_messages_gift_send", table_name="artist_mail_messages", schema=S)
    op.drop_column("artist_mail_messages", "gift_send_id", schema=S)
    op.drop_index("ix_gift_mail_sends_state", table_name="gift_mail_sends", schema=S)
    op.drop_index("ix_gift_mail_sends_campaign", table_name="gift_mail_sends", schema=S)
    op.drop_table("gift_mail_sends", schema=S)
