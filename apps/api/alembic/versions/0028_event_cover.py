"""Events carry official artwork (OD-06; owner 2026-10-23: square, same rules as music covers).
Additive only.

Revision ID: 0028_event_cover
Revises: 0027_order_item_product
Create Date: 2026-10-23

`events.events.cover_asset_id` points at the accepted poster; uploads may now target an event.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0028_event_cover"
down_revision: Union[str, Sequence[str], None] = "0027_order_item_product"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "cover_asset_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents.media_assets.id", name="fk_events_cover_asset_id_media_assets"),
            nullable=True,
        ),
        schema="events",
    )
    op.drop_constraint("ck_upload_intents_target_type", "upload_intents", schema="documents", type_="check")
    op.create_check_constraint(
        op.f("ck_upload_intents_target_type"),
        "upload_intents",
        "target_type IN ('track_version','release_cover','event_cover')",
        schema="documents",
    )


def downgrade() -> None:
    op.drop_constraint("ck_upload_intents_target_type", "upload_intents", schema="documents", type_="check")
    op.create_check_constraint(
        op.f("ck_upload_intents_target_type"),
        "upload_intents",
        "target_type IN ('track_version','release_cover')",
        schema="documents",
    )
    op.drop_column("events", "cover_asset_id", schema="events")
