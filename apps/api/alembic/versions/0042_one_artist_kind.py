"""Every band is an artist, and every artist has a team. Additive only.

Revision ID: 0042_one_artist_kind
Revises: 0041_simple_addresses
Create Date: 2026-10-30

Owner, 2026-10-30 (D-ARTIST-UNIFY-01):
- Solo artists and bands are one kind of profile. Every band gets a row in `artists.artists` with
  the band's own id and `kind = 'BAND'`; `artists.bands` keeps what only a band has (its lineup and
  band lifecycle), keyed by the same id. Songs, releases and bookings keep pointing where they do.
- One management system for both: a profile has one owner and any number of managers
  (`artists.artist_team_members`). Managers see what the owner sees (music, files, sales, buyer
  names, payouts). A new manager waits for staff approval after the owner picks them.
- Today's people carry over: the account that claimed a solo profile owns it; a band's admins run
  the band, the earliest one as owner and the rest as managers.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0042_one_artist_kind"
down_revision: Union[str, Sequence[str], None] = "0041_simple_addresses"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.add_column(
        "artists",
        sa.Column("kind", sa.String(8), nullable=False, server_default="SOLO"),
        schema="artists",
    )
    op.create_check_constraint("ck_artists_kind", "artists", "kind IN ('SOLO','BAND')", schema="artists")
    op.create_index("ix_artists_kind", "artists", ["kind"], schema="artists")

    # A band's public state, said in artist words (the band's own state stays on artists.bands).
    op.execute(
        """
        INSERT INTO artists.artists
            (id, kind, stage_name, bio, status, primary_org_id, portrait_asset_id,
             created_at, updated_at, created_by, updated_by, deleted_at, version)
        SELECT b.id, 'BAND', b.name, b.bio,
               CASE b.status
                   WHEN 'ACTIVE' THEN 'ACTIVE'
                   WHEN 'HIATUS' THEN 'SUSPENDED'
                   WHEN 'DISBANDED' THEN 'TERMINATED'
                   ELSE 'APPROVED'
               END,
               b.primary_org_id, b.portrait_asset_id,
               b.created_at, b.updated_at, b.created_by, b.updated_by, b.deleted_at, 1
        FROM artists.bands b
        WHERE NOT EXISTS (SELECT 1 FROM artists.artists a WHERE a.id = b.id)
        """
    )
    op.create_foreign_key(
        "fk_bands_id_artists", "bands", "artists", ["id"], ["id"],
        source_schema="artists", referent_schema="artists",
    )

    op.create_table(
        "artist_team_members",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("artist_id", UUID, sa.ForeignKey("artists.artists.id"), nullable=False),
        sa.Column("user_id", UUID, sa.ForeignKey("identity.users.id"), nullable=False),
        sa.Column("role", sa.String(8), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="PENDING"),
        sa.Column("requested_by", UUID, sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("reviewed_by", UUID, sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("ended_by", UUID, sa.ForeignKey("identity.users.id"), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("updated_by", UUID, nullable=True),
        sa.CheckConstraint("role IN ('OWNER','MANAGER')", name="ck_artist_team_members_role"),
        sa.CheckConstraint(
            "status IN ('PENDING','ACTIVE','REJECTED','WITHDRAWN','REMOVED')",
            name="ck_artist_team_members_status",
        ),
        schema="artists",
    )
    op.create_index("ix_artist_team_members_artist_id", "artist_team_members", ["artist_id"], schema="artists")
    op.create_index("ix_artist_team_members_user_id", "artist_team_members", ["user_id"], schema="artists")
    op.create_index("ix_artist_team_members_status", "artist_team_members", ["status"], schema="artists")
    op.create_index(
        "uq_artist_team_members_open",
        "artist_team_members",
        ["artist_id", "user_id"],
        unique=True,
        schema="artists",
        postgresql_where=sa.text("status IN ('PENDING','ACTIVE')"),
    )
    op.create_index(
        "uq_artist_team_members_owner",
        "artist_team_members",
        ["artist_id"],
        unique=True,
        schema="artists",
        postgresql_where=sa.text("role = 'OWNER' AND status = 'ACTIVE'"),
    )

    op.execute(
        """
        INSERT INTO artists.artist_team_members
            (id, artist_id, user_id, role, status, reviewed_at, created_at, updated_at)
        SELECT gen_random_uuid(), a.id, a.claimed_user_id, 'OWNER', 'ACTIVE', now(), now(), now()
        FROM artists.artists a
        WHERE a.kind = 'SOLO' AND a.claimed_user_id IS NOT NULL AND a.deleted_at IS NULL
        """
    )
    op.execute(
        """
        INSERT INTO artists.artist_team_members
            (id, artist_id, user_id, role, status, reviewed_at, created_at, updated_at)
        SELECT gen_random_uuid(), ranked.band_id, ranked.user_id,
               CASE WHEN ranked.n = 1 THEN 'OWNER' ELSE 'MANAGER' END, 'ACTIVE', now(), now(), now()
        FROM (
            SELECT m.band_id, m.user_id,
                   row_number() OVER (PARTITION BY m.band_id ORDER BY m.created_at, m.id) AS n
            FROM artists.band_members m
            JOIN artists.bands b ON b.id = m.band_id AND b.deleted_at IS NULL
            WHERE m.is_admin AND m.status = 'ACTIVE' AND m.user_id IS NOT NULL AND m.deleted_at IS NULL
        ) ranked
        """
    )


def downgrade() -> None:
    op.drop_table("artist_team_members", schema="artists")
    op.drop_constraint("fk_bands_id_artists", "bands", schema="artists", type_="foreignkey")
    op.execute("DELETE FROM artists.artists WHERE kind = 'BAND'")
    op.drop_index("ix_artists_kind", table_name="artists", schema="artists")
    op.drop_constraint("ck_artists_kind", "artists", schema="artists", type_="check")
    op.drop_column("artists", "kind", schema="artists")
