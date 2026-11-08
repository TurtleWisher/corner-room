"""Story cards (owner, 2026-11-08, D-STORY-01). Pure rules, no I/O.

Someone who owns a song (bought it, or is its act's own people) can share a moment of it as a story
card: a short video of a Corner Room card with the song's sound, for Instagram, Facebook and other
apps' stories. They choose the moment; it lasts at most `story_clip_max_ms` (30 s, owner). The act
can turn story sharing off per release; a song that is out on any release with the switch off can't
be shared (the act's wish wins). The video is made on the owner's own device from audio they are
already allowed to play, so making one is never a listen, a PlaybackEvent or royalty input.
"""

from __future__ import annotations

from typing import Literal

StoryReason = Literal["OK", "NOT_SIGNED_IN", "NOT_OWNED", "NOT_RELEASED", "SHARING_OFF", "STORIES_OFF"]


def story_reason(
    *,
    owns: bool,
    track_released: bool,
    release_switches: list[bool],
    clip_max_ms: int,
) -> StoryReason:
    """Whether a story card of this song may be made now, and if not, why (checked in this order)."""
    if clip_max_ms <= 0:
        return "STORIES_OFF"
    if not track_released or not release_switches:
        return "NOT_RELEASED"
    if not owns:
        return "NOT_OWNED"
    if not all(release_switches):
        return "SHARING_OFF"
    return "OK"
