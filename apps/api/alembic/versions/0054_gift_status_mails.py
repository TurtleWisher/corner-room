"""The artist's own wording for collectible status emails. Additive only.

Revision ID: 0054_gift_status_mails
Revises: 0053_teasers
Create Date: 2026-11-07

Owner, 2026-11-07 (D-CAMPAIGN-05): for each gift campaign the act may write its own email for the
statuses that tell the buyer (Dispatched, Returned, Missing) in the artist-email editor. Staff
approve each one; until then, and whenever the act goes back to it, Corner Room's wording sends.
An edit to an approved email waits for staff while the approved words (`live_*`) keep sending.
These emails are about something the buyer is owed, so a stop from the act's emails doesn't stop
them.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0054_gift_status_mails"
down_revision: Union[str, Sequence[str], None] = "0053_teasers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
S = "commerce"


def upgrade() -> None:
    op.create_table(
        "gift_status_mails",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("campaign_id", UUID, sa.ForeignKey("commerce.gift_campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("live_subject", sa.String(200), nullable=True),
        sa.Column("live_body", sa.Text(), nullable=True),
        sa.Column("sent_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("updated_by", UUID, nullable=True),
        sa.Column("submitted_by", UUID, nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", UUID, nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('DISPATCHED','RETURNED','MISSING')", name="ck_gift_status_mails_status"),
        sa.CheckConstraint("state IN ('DRAFT','IN_REVIEW','APPROVED','RETURNED')", name="ck_gift_status_mails_state"),
        sa.UniqueConstraint("campaign_id", "status", name="uq_gift_status_mails_campaign_status"),
        schema=S,
    )
    op.create_index("ix_gift_status_mails_state", "gift_status_mails", ["state"], schema=S)


def downgrade() -> None:
    op.drop_index("ix_gift_status_mails_state", table_name="gift_status_mails", schema=S)
    op.drop_table("gift_status_mails", schema=S)
