"""Audio platform Phase 8: buyer downloads and takedown kinds. Additive only.

Revision ID: 0022_downloads
Revises: 0021_release_commerce
Create Date: 2026-10-17

D-AUDIO-06: buyers download FLAC (lossless) or MP3 320. Rendition profiles and the copies made
from them gain a purpose (PLAYBACK or DOWNLOAD) so a download copy is never streamed and a
playback copy list never offers one; the codec check is widened to FLAC, and copies record the
bit depth they keep. D-AUDIO-14: tracks and releases record whether a takedown was an ordinary one
(buyers keep access) or a legal/rights one (access removed for everyone). Checks are widened,
never narrowed; existing rows keep their meaning (every existing copy is a playback copy).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022_downloads"
down_revision: Union[str, Sequence[str], None] = "0021_release_commerce"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PURPOSE = "purpose IN ('PLAYBACK','DOWNLOAD')"
TAKEDOWN = "takedown_kind IS NULL OR takedown_kind IN ('STANDARD','LEGAL')"


def upgrade() -> None:
    op.drop_constraint("ck_rendition_profiles_codec", "rendition_profiles", schema="music", type_="check")
    op.create_check_constraint(
        "ck_rendition_profiles_codec", "rendition_profiles", "codec IN ('opus','mp3','flac')", schema="music"
    )
    for table in ("rendition_profiles", "track_renditions"):
        op.add_column(
            table, sa.Column("purpose", sa.String(16), nullable=False, server_default="PLAYBACK"), schema="music"
        )
        op.create_check_constraint(f"ck_{table}_purpose", table, PURPOSE, schema="music")
    op.add_column("track_renditions", sa.Column("bit_depth", sa.Integer(), nullable=True), schema="music")
    for table in ("tracks", "releases"):
        op.add_column(table, sa.Column("takedown_kind", sa.String(16), nullable=True), schema="music")
        op.create_check_constraint(f"ck_{table}_takedown_kind", table, TAKEDOWN, schema="music")


def downgrade() -> None:
    for table in ("tracks", "releases"):
        op.drop_constraint(f"ck_{table}_takedown_kind", table, schema="music", type_="check")
        op.drop_column(table, "takedown_kind", schema="music")
    op.drop_column("track_renditions", "bit_depth", schema="music")
    # Download copies cannot satisfy the old checks; remove them before narrowing back.
    op.execute("DELETE FROM music.track_renditions WHERE purpose = 'DOWNLOAD' OR codec = 'flac'")
    op.execute("DELETE FROM music.rendition_profiles WHERE purpose = 'DOWNLOAD' OR codec = 'flac'")
    for table in ("rendition_profiles", "track_renditions"):
        op.drop_constraint(f"ck_{table}_purpose", table, schema="music", type_="check")
        op.drop_column(table, "purpose", schema="music")
    op.drop_constraint("ck_rendition_profiles_codec", "rendition_profiles", schema="music", type_="check")
    op.create_check_constraint(
        "ck_rendition_profiles_codec", "rendition_profiles", "codec IN ('opus','mp3')", schema="music"
    )
