"""A fan gift's own email: subject, look, cover switch and files. Additive only.

Revision ID: 0062_fan_gift_email
Revises: 0061_fan_gifts
Create Date: 2026-11-20

Owner, 2026-11-20 (D-GIFT-FAN-02): a fan who sends a gift designs the email the people get (subject,
message, one of three looks, the music's cover on or off, pictures and PDFs) and sees it as each
person will. Staff review the whole email before anyone gets it (`fan_gifts.note_state`).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0062_fan_gift_email"
down_revision: Union[str, Sequence[str], None] = "0061_fan_gifts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column("fan_gifts", sa.Column("subject", sa.String(200), nullable=True), schema="commerce")
    op.add_column("fan_gifts", sa.Column("look", sa.String(10), nullable=False, server_default="SKY"), schema="commerce")
    op.add_column(
        "fan_gifts", sa.Column("show_cover", sa.Boolean(), nullable=False, server_default=sa.text("true")), schema="commerce"
    )
    op.create_check_constraint("ck_fan_gifts_look", "fan_gifts", "look IN ('SKY','EMBER','NIGHT')", schema="commerce")
    op.create_table(
        "fan_gift_files",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("owner_user_id", UUID, sa.ForeignKey("identity.users.id"), nullable=False),
        sa.Column("gift_id", UUID, sa.ForeignKey("commerce.fan_gifts.id"), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("object_key", sa.String(500), nullable=False),
        sa.Column("content_type", sa.String(120), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("kind IN ('IMAGE','PDF')", name="ck_fan_gift_files_kind"),
        schema="commerce",
    )
    op.create_index("ix_fan_gift_files_owner", "fan_gift_files", ["owner_user_id", "gift_id"], schema="commerce")
    op.create_index("ix_fan_gift_files_gift", "fan_gift_files", ["gift_id"], schema="commerce")


def downgrade() -> None:
    op.drop_index("ix_fan_gift_files_gift", table_name="fan_gift_files", schema="commerce")
    op.drop_index("ix_fan_gift_files_owner", table_name="fan_gift_files", schema="commerce")
    op.drop_table("fan_gift_files", schema="commerce")
    op.drop_constraint("ck_fan_gifts_look", "fan_gifts", schema="commerce", type_="check")
    op.drop_column("fan_gifts", "show_cover", schema="commerce")
    op.drop_column("fan_gifts", "look", schema="commerce")
    op.drop_column("fan_gifts", "subject", schema="commerce")
