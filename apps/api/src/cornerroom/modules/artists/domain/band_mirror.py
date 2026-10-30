"""Every band is an artist (owner, 2026-10-30, D-ARTIST-UNIFY-01).

A band's row in `artists.artists` has the band's own id and kind BAND and mirrors the band's name,
bio, picture, label and state. This runs before every flush of any session (API or worker), so no
band write can forget it. Band details stay authoritative on `bands`; the artist row is never
edited directly (ArtistService refuses edits to kind BAND).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

from cornerroom.kernel.ids import new_uuid
from cornerroom.modules.artists.domain.models import Artist, Band

# A band's state said in artist words, for public pages and Studio (the band's own state stays on
# `bands`). Only ACTIVE is public, as for both kinds before.
BAND_TO_ARTIST_STATUS = {
    "ACTIVE": "ACTIVE",
    "HIATUS": "SUSPENDED",
    "DISBANDED": "TERMINATED",
    "FORMING": "APPROVED",
}


def _mirror(session: Session, band: Band) -> None:
    if band.id is None:
        band.id = new_uuid()
    with session.no_autoflush:
        artist = session.get(Artist, band.id)
    if artist is None:
        artist = Artist(id=band.id, kind="BAND", created_by=band.created_by)
        session.add(artist)
    wanted = {
        "kind": "BAND",
        "stage_name": band.name,
        "bio": band.bio,
        "portrait_asset_id": band.portrait_asset_id,
        "primary_org_id": band.primary_org_id,
        "status": BAND_TO_ARTIST_STATUS.get(band.status, "APPROVED"),
        "deleted_at": band.deleted_at,
    }
    for field, value in wanted.items():
        if getattr(artist, field) != value:
            setattr(artist, field, value)
    if artist.updated_by != band.updated_by and band.updated_by is not None:
        artist.updated_by = band.updated_by


@event.listens_for(Session, "before_flush")
def keep_band_artists_in_step(session: Session, _flush_context: Any, _instances: Any) -> None:
    for obj in [*session.new, *session.dirty]:
        if isinstance(obj, Band):
            _mirror(session, obj)
