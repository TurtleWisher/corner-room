"""Gift campaigns run by artists and bands. Additive only.

Revision ID: 0039_gift_campaigns
Revises: 0038_release_change_requests
Create Date: 2026-10-28

Owner, 2026-10-28 (D-CAMPAIGN-01, D-CAMPAIGN-02): an artist or band sets up a gift campaign for
some or all of their music; staff approve publishing and every change; it can be paused and
restarted at any time (purchases while paused don't count). Everyone who bought a covered work
while it was active (and, if chosen, its pre-sale buyers) is a recipient; each recipient's gift is
yet to send, in process (dispatched: they get an email saying it's on its way) or sent. Free extras
only: no prices, no money.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0039_gift_campaigns"
down_revision: Union[str, Sequence[str], None] = "0038_release_change_requests"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _stamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    ]


def upgrade() -> None:
    op.create_table(
        "gift_campaigns",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("profile_type", sa.String(8), nullable=False),
        sa.Column("profile_id", UUID, nullable=False),
        sa.Column("organization_id", UUID, sa.ForeignKey("identity.organizations.id"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("gift_items", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sender", sa.String(16), nullable=False, server_default="ARTIST"),
        sa.Column("include_presale", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("counts_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("works", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("pending", postgresql.JSONB(), nullable=True),
        sa.Column("pending_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pending_by", UUID, nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("submitted_by", UUID, nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", UUID, nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        *_stamps(),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_gift_campaigns_profile_type"),
        sa.CheckConstraint("sender IN ('ARTIST','CORNER_ROOM')", name="ck_gift_campaigns_sender"),
        sa.CheckConstraint("status IN ('DRAFT','IN_REVIEW','ACTIVE','PAUSED','ENDED')", name="ck_gift_campaigns_status"),
        schema="commerce",
    )
    op.create_index("ix_gift_campaigns_profile", "gift_campaigns", ["profile_type", "profile_id"], schema="commerce")
    op.create_index("ix_gift_campaigns_status", "gift_campaigns", ["organization_id", "status"], schema="commerce")

    op.create_table(
        "gift_campaign_periods",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("campaign_id", UUID, sa.ForeignKey("commerce.gift_campaigns.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
        schema="commerce",
    )
    op.create_index("ix_gift_campaign_periods_campaign", "gift_campaign_periods", ["campaign_id"], schema="commerce")

    op.create_table(
        "gift_recipients",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("campaign_id", UUID, sa.ForeignKey("commerce.gift_campaigns.id"), nullable=False),
        sa.Column("user_id", UUID, sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("order_id", UUID, nullable=True),
        sa.Column("presale_claim_id", UUID, nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="YET_TO_SEND"),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dispatched_by", UUID, nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_by", UUID, nullable=True),
        *_stamps(),
        sa.CheckConstraint("status IN ('YET_TO_SEND','IN_PROCESS','SENT')", name="ck_gift_recipients_status"),
        schema="commerce",
    )
    op.create_index("ix_gift_recipients_campaign", "gift_recipients", ["campaign_id", "status"], schema="commerce")
    op.create_index(
        "uq_gift_recipients_email",
        "gift_recipients",
        ["campaign_id", sa.text("lower(email)")],
        unique=True,
        schema="commerce",
    )


def downgrade() -> None:
    op.drop_index("uq_gift_recipients_email", table_name="gift_recipients", schema="commerce")
    op.drop_index("ix_gift_recipients_campaign", table_name="gift_recipients", schema="commerce")
    op.drop_table("gift_recipients", schema="commerce")
    op.drop_index("ix_gift_campaign_periods_campaign", table_name="gift_campaign_periods", schema="commerce")
    op.drop_table("gift_campaign_periods", schema="commerce")
    op.drop_index("ix_gift_campaigns_status", table_name="gift_campaigns", schema="commerce")
    op.drop_index("ix_gift_campaigns_profile", table_name="gift_campaigns", schema="commerce")
    op.drop_table("gift_campaigns", schema="commerce")
