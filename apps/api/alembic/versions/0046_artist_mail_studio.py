"""Artist email studio: thank-you versions, scheduling, HTML emails, link clicks and files. Additive only.

Revision ID: 0046_artist_mail_studio
Revises: 0045_artist_mail
Create Date: 2026-11-02

Owner, 2026-11-02 (D-MAIL-02): an act keeps several thank-you emails, each for an audience (everyone
or pre-sale buyers, any music or chosen songs and releases); the most specific one that fits a
purchase is sent. Emails to buyers can be scheduled, carry links inside the text (HTML emails with a
plain-text copy, the cover and a Listen button), soft-copy files or links for a gift, and count link
clicks for the act's report. No open tracking. An act's single thank-you from 0045 becomes its
"everyone, any music" version.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0046_artist_mail_studio"
down_revision: Union[str, Sequence[str], None] = "0045_artist_mail"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB()


def _stamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    ]


def upgrade() -> None:
    op.create_table(
        "artist_mail_thank_yous",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("profile_type", sa.String(8), nullable=False),
        sa.Column("profile_id", UUID, nullable=False),
        sa.Column("organization_id", UUID, sa.ForeignKey("identity.organizations.id"), nullable=True),
        sa.Column("audience", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("is_on", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("file_ids", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("updated_by", UUID, nullable=True),
        *_stamps(),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_artist_mail_thank_yous_profile_type"),
        schema="commerce",
    )
    op.create_index("ix_artist_mail_thank_yous_profile", "artist_mail_thank_yous", ["profile_type", "profile_id"], schema="commerce")
    # 0045's one thank-you per act carries over as its "everyone, any music" version.
    op.execute(
        """
        INSERT INTO commerce.artist_mail_thank_yous (id, profile_type, profile_id, organization_id, audience, subject, body, is_on, updated_by)
        SELECT gen_random_uuid(), profile_type, profile_id, organization_id, '{"works": [], "who": "ALL"}'::jsonb,
               COALESCE(thank_you_subject, 'Thank you for buying {music}'),
               COALESCE(thank_you_body, E'Hi {buyer_name},\\n\\nThank you for buying {music}. It means a lot.\\n\\n{artist}'),
               thank_you_on, updated_by
        FROM commerce.artist_mail_settings
        WHERE thank_you_on OR thank_you_subject IS NOT NULL OR thank_you_body IS NOT NULL
        """
    )

    op.create_table(
        "artist_mail_files",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("profile_type", sa.String(8), nullable=False),
        sa.Column("profile_id", UUID, nullable=False),
        sa.Column("organization_id", UUID, sa.ForeignKey("identity.organizations.id"), nullable=True),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("object_key", sa.String(500), nullable=True),
        sa.Column("content_type", sa.String(120), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
        sa.CheckConstraint("profile_type IN ('artist','band')", name="ck_artist_mail_files_profile_type"),
        sa.CheckConstraint("kind IN ('FILE','LINK')", name="ck_artist_mail_files_kind"),
        schema="commerce",
    )
    op.create_index("ix_artist_mail_files_profile", "artist_mail_files", ["profile_type", "profile_id"], schema="commerce")

    op.add_column("artist_mails", sa.Column("send_at", sa.DateTime(timezone=True), nullable=True), schema="commerce")
    op.add_column("artist_mails", sa.Column("occasion", sa.String(32), nullable=True), schema="commerce")
    op.add_column("artist_mails", sa.Column("file_ids", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")), schema="commerce")
    op.add_column("artist_mails", sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True), schema="commerce")
    op.drop_constraint("ck_artist_mails_status", "artist_mails", schema="commerce", type_="check")
    op.create_check_constraint(
        "ck_artist_mails_status", "artist_mails", "status IN ('DRAFT','IN_REVIEW','SCHEDULED','SENDING','SENT')", schema="commerce"
    )
    op.create_index(
        "ix_artist_mails_scheduled", "artist_mails", ["send_at"], schema="commerce",
        postgresql_where=sa.text("status = 'SCHEDULED'"),
    )

    op.add_column("artist_mail_templates", sa.Column("occasion", sa.String(32), nullable=True), schema="commerce")
    op.add_column("artist_mail_templates", sa.Column("file_ids", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")), schema="commerce")

    op.add_column("artist_mail_messages", sa.Column("html", sa.Text(), nullable=True), schema="commerce")
    op.add_column("artist_mail_messages", sa.Column("links", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")), schema="commerce")
    op.add_column("artist_mail_messages", sa.Column("link_token", sa.String(64), nullable=True), schema="commerce")
    op.add_column("artist_mail_messages", sa.Column("thank_you_id", UUID, nullable=True), schema="commerce")
    op.add_column("artist_mail_messages", sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"), schema="commerce")
    op.add_column("artist_mail_messages", sa.Column("last_error", sa.String(300), nullable=True), schema="commerce")
    op.drop_constraint("ck_artist_mail_messages_status", "artist_mail_messages", schema="commerce", type_="check")
    op.create_check_constraint(
        "ck_artist_mail_messages_status", "artist_mail_messages", "status IN ('PENDING','SENT','SUPPRESSED','FAILED')",
        schema="commerce",
    )
    op.create_index(
        "uq_artist_mail_messages_link_token", "artist_mail_messages", ["link_token"], unique=True, schema="commerce",
        postgresql_where=sa.text("link_token IS NOT NULL"),
    )
    op.create_index("ix_artist_mail_messages_profile", "artist_mail_messages", ["profile_type", "profile_id", "kind"], schema="commerce")

    op.create_table(
        "artist_mail_clicks",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("message_id", UUID, sa.ForeignKey("commerce.artist_mail_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("clicked_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("kind IN ('LINK','LISTEN','FILE')", name="ck_artist_mail_clicks_kind"),
        schema="commerce",
    )
    op.create_index("ix_artist_mail_clicks_message", "artist_mail_clicks", ["message_id"], schema="commerce")

    # Which email a buyer used to stop an act's emails, for the email's report.
    op.add_column(
        "artist_mail_opt_outs",
        sa.Column("message_id", UUID, sa.ForeignKey("commerce.artist_mail_messages.id", ondelete="SET NULL"), nullable=True),
        schema="commerce",
    )


def downgrade() -> None:
    op.drop_column("artist_mail_opt_outs", "message_id", schema="commerce")
    op.drop_index("ix_artist_mail_clicks_message", table_name="artist_mail_clicks", schema="commerce")
    op.drop_table("artist_mail_clicks", schema="commerce")
    op.drop_index("ix_artist_mail_messages_profile", table_name="artist_mail_messages", schema="commerce")
    op.drop_index("uq_artist_mail_messages_link_token", table_name="artist_mail_messages", schema="commerce")
    op.drop_constraint("ck_artist_mail_messages_status", "artist_mail_messages", schema="commerce", type_="check")
    op.execute("UPDATE commerce.artist_mail_messages SET status = 'PENDING' WHERE status = 'FAILED'")
    op.create_check_constraint(
        "ck_artist_mail_messages_status", "artist_mail_messages", "status IN ('PENDING','SENT','SUPPRESSED')", schema="commerce"
    )
    for column in ("last_error", "attempts", "thank_you_id", "link_token", "links", "html"):
        op.drop_column("artist_mail_messages", column, schema="commerce")
    op.drop_column("artist_mail_templates", "file_ids", schema="commerce")
    op.drop_column("artist_mail_templates", "occasion", schema="commerce")
    op.drop_index("ix_artist_mails_scheduled", table_name="artist_mails", schema="commerce")
    op.drop_constraint("ck_artist_mails_status", "artist_mails", schema="commerce", type_="check")
    op.execute("UPDATE commerce.artist_mails SET status = 'DRAFT' WHERE status = 'SCHEDULED'")
    op.create_check_constraint(
        "ck_artist_mails_status", "artist_mails", "status IN ('DRAFT','IN_REVIEW','SENDING','SENT')", schema="commerce"
    )
    for column in ("sent_at", "file_ids", "occasion", "send_at"):
        op.drop_column("artist_mails", column, schema="commerce")
    op.drop_index("ix_artist_mail_files_profile", table_name="artist_mail_files", schema="commerce")
    op.drop_table("artist_mail_files", schema="commerce")
    op.drop_index("ix_artist_mail_thank_yous_profile", table_name="artist_mail_thank_yous", schema="commerce")
    op.drop_table("artist_mail_thank_yous", schema="commerce")
