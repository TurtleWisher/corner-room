"""Artist emails: thank-you emails, emails to buyers, saved templates and opt-outs. Additive only.

Revision ID: 0045_artist_mail
Revises: 0044_lyric_timings
Create Date: 2026-11-02

Owner, 2026-11-02 (D-MAIL-01): an artist or band thanks every buyer by email automatically (text
editable any time, goes live at once, always sent), and writes emails to their buyers (all, pre-sale
or picked, of chosen songs and releases) that staff approve before Corner Room sends them. Buyers can
stop an act's emails (one-click link or a switch on /account); the thank-you still sends. Artists
see buyers' names only (D-BUYERS-01). One row per message, so every email has a status.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0045_artist_mail"
down_revision: Union[str, Sequence[str], None] = "0044_lyric_timings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def _stamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    ]


def _profile() -> list[sa.Column]:
    return [
        sa.Column("profile_type", sa.String(8), nullable=False),
        sa.Column("profile_id", UUID, nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "artist_mail_settings",
        sa.Column("id", UUID, primary_key=True),
        *_profile(),
        sa.Column("organization_id", UUID, sa.ForeignKey("identity.organizations.id"), nullable=True),
        sa.Column("thank_you_on", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("thank_you_subject", sa.String(200), nullable=True),
        sa.Column("thank_you_body", sa.Text(), nullable=True),
        sa.Column("updated_by", UUID, nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        *_stamps(),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_artist_mail_settings_profile_type"),
        sa.UniqueConstraint("profile_type", "profile_id", name="uq_artist_mail_settings_profile"),
        schema="commerce",
    )

    op.create_table(
        "artist_mail_templates",
        sa.Column("id", UUID, primary_key=True),
        *_profile(),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("audience", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("updated_by", UUID, nullable=True),
        *_stamps(),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_artist_mail_templates_profile_type"),
        schema="commerce",
    )
    op.create_index("ix_artist_mail_templates_profile", "artist_mail_templates", ["profile_type", "profile_id"], schema="commerce")

    op.create_table(
        "artist_mails",
        sa.Column("id", UUID, primary_key=True),
        *_profile(),
        sa.Column("organization_id", UUID, sa.ForeignKey("identity.organizations.id"), nullable=True),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("audience", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("submitted_by", UUID, nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", UUID, nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recipient_count", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        *_stamps(),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_artist_mails_profile_type"),
        sa.CheckConstraint("status IN ('DRAFT','IN_REVIEW','SENDING','SENT')", name="ck_artist_mails_status"),
        schema="commerce",
    )
    op.create_index("ix_artist_mails_profile", "artist_mails", ["profile_type", "profile_id"], schema="commerce")
    op.create_index("ix_artist_mails_status", "artist_mails", ["organization_id", "status"], schema="commerce")

    op.create_table(
        "artist_mail_messages",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        *_profile(),
        sa.Column("mail_id", UUID, sa.ForeignKey("commerce.artist_mails.id"), nullable=True),
        sa.Column("order_id", UUID, sa.ForeignKey("commerce.orders.id"), nullable=True),
        sa.Column("user_id", UUID, sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("from_name", sa.String(200), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("stop_token", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_artist_mail_messages_profile_type"),
        sa.CheckConstraint("kind IN ('THANK_YOU','MANUAL','TEST')", name="ck_artist_mail_messages_kind"),
        sa.CheckConstraint("status IN ('PENDING','SENT','SUPPRESSED')", name="ck_artist_mail_messages_status"),
        schema="commerce",
    )
    op.create_index("ix_artist_mail_messages_mail", "artist_mail_messages", ["mail_id", "status"], schema="commerce")
    # One thank-you per order and act, however often the order's paid event is seen.
    op.create_index(
        "uq_artist_mail_messages_thank_you", "artist_mail_messages", ["profile_type", "profile_id", "order_id"],
        unique=True, schema="commerce", postgresql_where=sa.text("kind = 'THANK_YOU'"),
    )
    op.create_index(
        "uq_artist_mail_messages_stop_token", "artist_mail_messages", ["stop_token"], unique=True, schema="commerce",
        postgresql_where=sa.text("stop_token IS NOT NULL"),
    )

    op.create_table(
        "artist_mail_opt_outs",
        sa.Column("id", UUID, primary_key=True),
        *_profile(),
        sa.Column("user_id", UUID, sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("email", sa.String(320), nullable=False),
        *_stamps(),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_artist_mail_opt_outs_profile_type"),
        schema="commerce",
    )
    op.create_index(
        "uq_artist_mail_opt_outs_email", "artist_mail_opt_outs", ["profile_type", "profile_id", sa.text("lower(email)")],
        unique=True, schema="commerce",
    )
    op.create_index("ix_artist_mail_opt_outs_user", "artist_mail_opt_outs", ["user_id"], schema="commerce")


def downgrade() -> None:
    op.drop_index("ix_artist_mail_opt_outs_user", table_name="artist_mail_opt_outs", schema="commerce")
    op.drop_index("uq_artist_mail_opt_outs_email", table_name="artist_mail_opt_outs", schema="commerce")
    op.drop_table("artist_mail_opt_outs", schema="commerce")
    op.drop_index("uq_artist_mail_messages_stop_token", table_name="artist_mail_messages", schema="commerce")
    op.drop_index("uq_artist_mail_messages_thank_you", table_name="artist_mail_messages", schema="commerce")
    op.drop_index("ix_artist_mail_messages_mail", table_name="artist_mail_messages", schema="commerce")
    op.drop_table("artist_mail_messages", schema="commerce")
    op.drop_index("ix_artist_mails_status", table_name="artist_mails", schema="commerce")
    op.drop_index("ix_artist_mails_profile", table_name="artist_mails", schema="commerce")
    op.drop_table("artist_mails", schema="commerce")
    op.drop_index("ix_artist_mail_templates_profile", table_name="artist_mail_templates", schema="commerce")
    op.drop_table("artist_mail_templates", schema="commerce")
    op.drop_table("artist_mail_settings", schema="commerce")
