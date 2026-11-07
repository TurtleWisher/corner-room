"""Gift status emails get a button, files and the artist-email pipeline. Additive only.

Revision ID: 0055_gift_email_composer
Revises: 0054_gift_status_mails
Create Date: 2026-11-07

Owner, 2026-11-07 (D-CAMPAIGN-06): the act's gift status emails work like its other emails: a
button with its own words and link, files for the gift, a preview as each buyer, a test, and
sending the email for one status to chosen buyers. Every gift status email, the act's own words or
Corner Room's, now goes out as an artist email of kind GIFT_UPDATE (greeting each buyer by name,
links counted, files downloadable), never stopped by "stop emails from this act".
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0055_gift_email_composer"
down_revision: Union[str, Sequence[str], None] = "0054_gift_status_mails"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
JSONB = postgresql.JSONB
S = "commerce"
T = "gift_status_mails"


def upgrade() -> None:
    op.add_column(T, sa.Column("button_label", sa.String(80), nullable=True), schema=S)
    op.add_column(T, sa.Column("button_url", sa.String(2000), nullable=True), schema=S)
    op.add_column(T, sa.Column("file_ids", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")), schema=S)
    op.add_column(T, sa.Column("live_button_label", sa.String(80), nullable=True), schema=S)
    op.add_column(T, sa.Column("live_button_url", sa.String(2000), nullable=True), schema=S)
    op.add_column(T, sa.Column("live_file_ids", JSONB, nullable=True), schema=S)
    op.add_column("artist_mail_messages", sa.Column("gift_recipient_id", UUID, nullable=True), schema=S)
    op.add_column("artist_mail_messages", sa.Column("gift_status", sa.String(16), nullable=True), schema=S)
    op.create_index("ix_artist_mail_messages_gift_recipient", "artist_mail_messages", ["gift_recipient_id"], schema=S)
    op.drop_constraint("ck_artist_mail_messages_kind", "artist_mail_messages", schema=S, type_="check")
    op.create_check_constraint(
        "ck_artist_mail_messages_kind", "artist_mail_messages", "kind IN ('THANK_YOU','MANUAL','TEST','GIFT','GIFT_UPDATE')", schema=S
    )


def downgrade() -> None:
    op.execute("DELETE FROM commerce.artist_mail_messages WHERE kind = 'GIFT_UPDATE'")
    op.drop_constraint("ck_artist_mail_messages_kind", "artist_mail_messages", schema=S, type_="check")
    op.create_check_constraint(
        "ck_artist_mail_messages_kind", "artist_mail_messages", "kind IN ('THANK_YOU','MANUAL','TEST','GIFT')", schema=S
    )
    op.drop_index("ix_artist_mail_messages_gift_recipient", table_name="artist_mail_messages", schema=S)
    op.drop_column("artist_mail_messages", "gift_status", schema=S)
    op.drop_column("artist_mail_messages", "gift_recipient_id", schema=S)
    for c in ("live_file_ids", "live_button_url", "live_button_label", "file_ids", "button_url", "button_label"):
        op.drop_column(T, c, schema=S)
