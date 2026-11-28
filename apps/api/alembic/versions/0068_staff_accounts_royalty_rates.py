"""Staff accounts added by email, and each artist's royalty rate. Additive only.

Revision ID: 0068_staff_accounts_royalty_rates
Revises: 0067_corner_room_wrap
Create Date: 2026-11-28

Owner, 2026-11-28 (D-STAFF-ACCOUNTS-01): admins add staff and admin accounts by email in the
staff portal. Someone who already has a verified Corner Room account (a fan account, or one
made by Continue with Google) gets the staff roles at once; anyone else waits here as a
`staff_invites` row until an account with that email is verified (Google sign-in makes it
verified), then the roles are given and the row is ACCEPTED. Only the owner adds admins.

Owner, 2026-11-28 (D-ROYALTY-RATE-01): staff set a royalty percentage per artist (solo or band,
`artists.artists.id`), agreed with that artist. It is a share of what the fan paid for that
artist's music, on every sale. A rate covers sales from `effective_from` (null: from the very
start) until `effective_to` (null: still the current rate). Rows are never edited except to
close the current one when a new rate replaces it, so every sale keeps the rate it was made at.
`covers_earlier` marks a row the admin added to give earlier sales that had no rate this one.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0068_staff_accounts_royalty_rates"
down_revision: Union[str, Sequence[str], None] = "0067_corner_room_wrap"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "staff_invites",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("level", sa.String(16), nullable=False),
        sa.Column("areas", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="WAITING"),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint("level IN ('ADMIN','STAFF')", name="ck_staff_invites_level"),
        sa.CheckConstraint("status IN ('WAITING','ACCEPTED','CANCELLED')", name="ck_staff_invites_status"),
        schema="identity",
    )
    # One waiting invite per email.
    op.create_index(
        "uq_staff_invites_waiting_email",
        "staff_invites",
        ["email"],
        unique=True,
        schema="identity",
        postgresql_where=sa.text("status = 'WAITING'"),
    )

    op.create_table(
        "artist_rates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("artist_id", sa.Uuid(), sa.ForeignKey("artists.artists.id"), nullable=False),
        sa.Column("share_bps", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("covers_earlier", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("note", sa.String(1000), nullable=True),
        sa.Column("ended_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint("share_bps >= 0 AND share_bps <= 10000", name="ck_artist_rates_share_bps"),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from",
            name="ck_artist_rates_range",
        ),
        schema="royalties",
    )
    op.create_index("ix_artist_rates_artist", "artist_rates", ["artist_id", "effective_from"], schema="royalties")
    # At most one current rate per artist.
    op.create_index(
        "uq_artist_rates_current",
        "artist_rates",
        ["artist_id"],
        unique=True,
        schema="royalties",
        postgresql_where=sa.text("effective_to IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_artist_rates_current", table_name="artist_rates", schema="royalties")
    op.drop_index("ix_artist_rates_artist", table_name="artist_rates", schema="royalties")
    op.drop_table("artist_rates", schema="royalties")
    op.drop_index("uq_staff_invites_waiting_email", table_name="staff_invites", schema="identity")
    op.drop_table("staff_invites", schema="identity")
