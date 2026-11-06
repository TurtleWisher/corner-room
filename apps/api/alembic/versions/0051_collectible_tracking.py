"""Collectible tracking for gift campaigns. Additive only.

Revision ID: 0051_collectible_tracking
Revises: 0050_music_gifts
Create Date: 2026-11-06

Owner, 2026-11-06 (D-CAMPAIGN-03): each collectible a buyer earned is tracked as not prepared
(YET_TO_SEND), PREPARED, DISPATCHED, RECEIVED, RETURNED or MISSING. A prepared gift may be given a
dispatch time and the worker dispatches it when the time comes. Existing rows move with the
owner's mapping: IN_PROCESS (dispatched, the buyer was told) becomes DISPATCHED and SENT becomes
RECEIVED, with its time kept as the outcome.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0051_collectible_tracking"
down_revision: Union[str, Sequence[str], None] = "0050_music_gifts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)
NEW_STATUSES = "status IN ('YET_TO_SEND','PREPARED','DISPATCHED','RECEIVED','RETURNED','MISSING')"
OLD_STATUSES = "status IN ('YET_TO_SEND','IN_PROCESS','SENT')"


def upgrade() -> None:
    for name, type_ in (
        ("prepared_at", sa.DateTime(timezone=True)),
        ("prepared_by", UUID),
        ("dispatch_at", sa.DateTime(timezone=True)),
        ("dispatch_set_by", UUID),
        ("outcome_at", sa.DateTime(timezone=True)),
        ("outcome_by", UUID),
    ):
        op.add_column("gift_recipients", sa.Column(name, type_, nullable=True), schema="commerce")
    op.drop_constraint("ck_gift_recipients_status", "gift_recipients", schema="commerce", type_="check")
    op.execute("UPDATE commerce.gift_recipients SET status = 'DISPATCHED' WHERE status = 'IN_PROCESS'")
    op.execute(
        "UPDATE commerce.gift_recipients SET status = 'RECEIVED', outcome_at = sent_at, outcome_by = sent_by "
        "WHERE status = 'SENT'"
    )
    op.create_check_constraint("ck_gift_recipients_status", "gift_recipients", NEW_STATUSES, schema="commerce")
    op.create_index(
        "ix_gift_recipients_dispatch_due",
        "gift_recipients",
        ["dispatch_at"],
        schema="commerce",
        postgresql_where=sa.text("status = 'PREPARED' AND dispatch_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_gift_recipients_dispatch_due", table_name="gift_recipients", schema="commerce")
    op.drop_constraint("ck_gift_recipients_status", "gift_recipients", schema="commerce", type_="check")
    op.execute("UPDATE commerce.gift_recipients SET status = 'YET_TO_SEND' WHERE status = 'PREPARED'")
    op.execute("UPDATE commerce.gift_recipients SET status = 'IN_PROCESS' WHERE status = 'DISPATCHED'")
    op.execute(
        "UPDATE commerce.gift_recipients SET status = 'SENT', sent_at = COALESCE(sent_at, outcome_at) "
        "WHERE status IN ('RECEIVED','RETURNED','MISSING')"
    )
    op.create_check_constraint("ck_gift_recipients_status", "gift_recipients", OLD_STATUSES, schema="commerce")
    for name in ("outcome_by", "outcome_at", "dispatch_set_by", "dispatch_at", "prepared_by", "prepared_at"):
        op.drop_column("gift_recipients", name, schema="commerce")
