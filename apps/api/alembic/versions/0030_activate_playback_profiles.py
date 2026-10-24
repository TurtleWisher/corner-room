"""Switch the two playback copies on for production. Data only, no schema change.

Revision ID: 0030_activate_playback_profiles
Revises: 0029_profile_pictures
Create Date: 2026-10-25

Owner, 2026-10-25 (D-AUDIO-18): music streaming launches on 2026-10-26, so the copies built in AUDIO
Phase 3 (Opus 160 kbps, MP3 320 kbps fallback, D-AUDIO-03) go from CANDIDATE to ACTIVE without the
formal listening test. Production plays only ACTIVE copies, so until now no song could play there.
The worker then makes the copies for songs already uploaded (`enqueue_missing_renditions`).
Better bitrates can be added later as new profiles; nothing here is a business rule.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0030_activate_playback_profiles"
down_revision: Union[str, Sequence[str], None] = "0029_profile_pictures"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEYS = "('opus_hq', 'mp3_compat')"


def upgrade() -> None:
    op.execute(
        f"UPDATE music.rendition_profiles SET status = 'ACTIVE' "
        f"WHERE key IN {KEYS} AND purpose = 'PLAYBACK' AND status = 'CANDIDATE'"
    )


def downgrade() -> None:
    op.execute(
        f"UPDATE music.rendition_profiles SET status = 'CANDIDATE' "
        f"WHERE key IN {KEYS} AND purpose = 'PLAYBACK' AND status = 'ACTIVE'"
    )
