"""Trending Corner (owner, 2026-11-08, D-TRENDING-01).

The home page shows the music selling and being heard the most, in a turning carousel of discs.
Staff choose it by hand: no formula ranks it, because how much is "a lot" is the owner's call.
To help them choose, the staff list shows each song's and release's sales and listens. Staff of a
workspace pick music of that workspace (`music.approve`, like catalog review); everyone sees the
public list, which only ever holds released music that is still out.

Sales here are counts of things sold (refunds shown beside them), never money: money stays with
Studio Sales and finance. Listens are the public counted listens (D-LISTEN-01, D-LISTEN-02).
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.commerce.application.sales import CatalogSales
from cornerroom.modules.music.application.service import MusicService
from cornerroom.modules.music.domain import teasers as teaser_rules
from cornerroom.modules.music.domain.models import (
    Release,
    ReleaseTrack,
    Teaser,
    TeaserVersion,
    Track,
    TrackVersion,
    TrendingPick,
)
from cornerroom.modules.streaming.domain.models import Listen

KINDS = ("TRACK", "RELEASE")
# A technical ceiling so the home page never turns hundreds of discs; not a business rule.
MAX_PICKS = 24
# Candidates offered to staff per kind (search narrows it).
CANDIDATE_LIMIT = 40


def is_out(status: str | None, deleted_at: object) -> bool:
    """Only music that is out (released, not deleted or taken down) is ever shown to the public."""
    return status == "RELEASED" and deleted_at is None


def check_order(current: Iterable[UUID], wanted: list[UUID]) -> None:
    """A new order must name every pick exactly once, so nothing is lost or doubled by a stale page."""
    if len(wanted) != len(set(wanted)) or set(wanted) != set(current):
        raise AppError("STALE_ORDER", "The list changed. Reload and try again", 409)


class TrendingService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.music = MusicService(session)

    # --- public --------------------------------------------------------------------------------

    async def public_list(self) -> list[dict[str, Any]]:
        picks = (
            await self.session.execute(select(TrendingPick).order_by(TrendingPick.position, TrendingPick.created_at))
        ).scalars().all()
        if not picks:
            return []
        releases = await self._rows(Release, [p.release_id for p in picks if p.release_id])
        tracks = await self._rows(Track, [p.track_id for p in picks if p.track_id])

        # Each pick's songs, in order: a release's released songs, or the one song.
        songs_of: dict[UUID, list[Track]] = {}
        release_links = await self._release_songs([r.id for r in releases.values() if is_out(r.status, r.deleted_at)])
        for pick in picks:
            if pick.kind == "RELEASE":
                release = releases.get(pick.release_id)  # type: ignore[arg-type]
                if release and is_out(release.status, release.deleted_at):
                    songs_of[pick.id] = release_links.get(release.id, [])
            else:
                track = tracks.get(pick.track_id)  # type: ignore[arg-type]
                if track and is_out(track.status, track.deleted_at):
                    songs_of[pick.id] = [track]
        all_ids = list({t.id for songs in songs_of.values() for t in songs})
        released_on = await self._released_on(all_ids)
        listens = await self._listens(all_ids)
        durations = await self._durations(all_ids)
        teasers = await self._teasers(all_ids)
        # A song picked alone takes its cover from the first release it is out on.
        cover_releases = await self._rows(Release, [ids[0] for t in tracks.values() if (ids := released_on.get(t.id))])

        out: list[dict[str, Any]] = []
        for pick in picks:
            songs = songs_of.get(pick.id)
            if not songs:
                continue
            if pick.kind == "RELEASE":
                release = releases[pick.release_id]  # type: ignore[index]
                title, artist_id, band_id, track_id = release.title, release.primary_artist_id, release.primary_band_id, None
            else:
                track = songs[0]
                first = released_on.get(track.id) or []
                release = cover_releases.get(first[0]) if first else None
                title, artist_id, band_id, track_id = track.title, track.primary_artist_id, track.primary_band_id, track.id
            out.append(
                {
                    "id": pick.id,
                    "kind": pick.kind,
                    "title": title,
                    "track_id": track_id,
                    "release_id": release.id if release else None,
                    "release_title": release.title if release else None,
                    "release_type": release.release_type if release else None,
                    "released_at": release.release_at if release else None,
                    "has_cover": bool(release and release.cover_asset_id),
                    "primary_artist_id": artist_id,
                    "primary_band_id": band_id,
                    "listens": sum(listens.get(t.id, 0) for t in songs),
                    "tracks": [
                        {
                            "id": t.id,
                            "title": t.title,
                            "duration_ms": durations.get(t.id),
                            "release_ids": released_on.get(t.id, []),
                            "teaser_id": teasers.get(t.id),
                            "listens": listens.get(t.id, 0),
                        }
                        for t in songs
                    ],
                }
            )
        return out

    # --- staff ---------------------------------------------------------------------------------

    async def _staff_org(self, ctx: AuthContext) -> UUID:
        """The staff member's workspace, when they may approve its music. Anyone else: 404."""
        org = ctx.organization_id
        if org is not None and await self.music._is_allowed(
            ctx.user_id, "music.approve", resource_type="release", resource_id=org, organization_id=org
        ):
            return org
        raise NotFoundError("Not found")

    async def staff_view(self, ctx: AuthContext, query: str | None = None) -> dict[str, Any]:
        org = await self._staff_org(ctx)
        picks = (
            await self.session.execute(
                select(TrendingPick)
                .where(TrendingPick.organization_id == org)
                .order_by(TrendingPick.position, TrendingPick.created_at)
            )
        ).scalars().all()
        text = " ".join((query or "").split())[:100]
        rel_stmt = select(Release).where(Release.primary_org_id == org, Release.status == "RELEASED", Release.deleted_at.is_(None))
        trk_stmt = select(Track).where(Track.primary_org_id == org, Track.status == "RELEASED", Track.deleted_at.is_(None))
        if text:
            rel_stmt = rel_stmt.where(Release.title.ilike(f"%{text}%"))
            trk_stmt = trk_stmt.where(Track.title.ilike(f"%{text}%"))
        cand_releases = list((await self.session.execute(rel_stmt.order_by(Release.release_at.desc().nulls_last()).limit(CANDIDATE_LIMIT))).scalars())
        cand_tracks = list((await self.session.execute(trk_stmt.order_by(Track.created_at.desc()).limit(CANDIDATE_LIMIT))).scalars())

        picked_releases = await self._rows(Release, [p.release_id for p in picks if p.release_id])
        picked_tracks = await self._rows(Track, [p.track_id for p in picks if p.track_id])
        all_releases = {**{r.id: r for r in cand_releases}, **picked_releases}
        all_tracks = {**{t.id: t for t in cand_tracks}, **picked_tracks}
        release_songs = await self._release_songs(list(all_releases), released_only=False)
        song_ids = list({t.id for songs in release_songs.values() for t in songs} | set(all_tracks))
        listens = await self._listens(song_ids)
        sold = await self._sold(list(all_tracks), list(all_releases))
        released_on = await self._released_on(list(all_tracks))
        cover_of = {tid: ids[0] for tid, ids in released_on.items() if ids}
        cover_rows = await self._rows(Release, list(cover_of.values()))

        def numbers(kind: str, sid: UUID) -> dict[str, Any]:
            if kind == "RELEASE":
                r = all_releases[sid]
                songs = release_songs.get(sid, [])
                return {
                    "kind": kind, "id": sid, "title": r.title, "release_type": r.release_type,
                    "release_id": sid, "has_cover": bool(r.cover_asset_id),
                    "primary_artist_id": r.primary_artist_id, "primary_band_id": r.primary_band_id,
                    "is_out": is_out(r.status, r.deleted_at),
                    "listens": sum(listens.get(t.id, 0) for t in songs),
                    **sold.get(("RELEASE", sid), {"sold": 0, "refunded": 0}),
                }
            t = all_tracks[sid]
            cover = cover_rows.get(cover_of.get(sid))  # type: ignore[arg-type]
            return {
                "kind": kind, "id": sid, "title": t.title, "release_type": None,
                "release_id": cover.id if cover else None, "has_cover": bool(cover and cover.cover_asset_id),
                "primary_artist_id": t.primary_artist_id, "primary_band_id": t.primary_band_id,
                "is_out": is_out(t.status, t.deleted_at),
                "listens": listens.get(sid, 0),
                **sold.get(("TRACK", sid), {"sold": 0, "refunded": 0}),
            }

        picked = {(p.kind, p.release_id or p.track_id) for p in picks}
        candidates = [numbers("RELEASE", r.id) for r in cand_releases] + [numbers("TRACK", t.id) for t in cand_tracks]
        candidates = [{**c, "picked": (c["kind"], c["id"]) in picked} for c in candidates]
        # Most sold first, then most heard: the numbers that make music trending.
        candidates.sort(key=lambda c: (-c["sold"], -c["listens"], c["title"].lower()))
        return {
            "picks": [{"pick_id": p.id, **numbers(p.kind, p.release_id or p.track_id)} for p in picks],  # type: ignore[arg-type]
            "candidates": candidates,
            "max_picks": MAX_PICKS,
        }

    async def add(self, ctx: AuthContext, kind: str, subject_id: UUID) -> TrendingPick:
        org = await self._staff_org(ctx)
        if kind not in KINDS:
            raise AppError("VALIDATION_ERROR", "Choose a song or a release", 422)
        row = await self.session.get(Release if kind == "RELEASE" else Track, subject_id)
        if row is None or row.primary_org_id != org:
            raise NotFoundError("Not found")
        if not is_out(row.status, row.deleted_at):
            raise AppError("NOT_RELEASED", "Only released music can trend", 409)
        column = TrendingPick.release_id if kind == "RELEASE" else TrendingPick.track_id
        if (await self.session.execute(select(TrendingPick.id).where(column == subject_id))).first():
            raise AppError("ALREADY_PICKED", "It is already in Trending Corner", 409)
        count = (await self.session.execute(select(func.count()).select_from(TrendingPick))).scalar_one()
        if count >= MAX_PICKS:
            raise AppError("TOO_MANY", f"Trending Corner holds {MAX_PICKS} at most. Take one out first", 409)
        last = (await self.session.execute(select(func.max(TrendingPick.position)))).scalar_one()
        pick = TrendingPick(
            kind=kind,
            track_id=subject_id if kind == "TRACK" else None,
            release_id=subject_id if kind == "RELEASE" else None,
            organization_id=org,
            position=(last or 0) + 1,
            created_by=ctx.user_id,
            updated_by=ctx.user_id,
        )
        self.session.add(pick)
        await self.session.flush()
        await AuditService(self.session).record_from_auth(
            ctx, action="trending.pick_added", entity_type="TrendingPick", entity_id=pick.id,
            new_state={"kind": kind, "subject_id": str(subject_id), "position": pick.position}, organization_id=org,
        )
        return pick

    async def remove(self, ctx: AuthContext, pick_id: UUID) -> None:
        org = await self._staff_org(ctx)
        pick = await self.session.get(TrendingPick, pick_id)
        if pick is None or pick.organization_id != org:
            raise NotFoundError("Not found")
        await self.session.delete(pick)
        await self.session.flush()
        await AuditService(self.session).record_from_auth(
            ctx, action="trending.pick_removed", entity_type="TrendingPick", entity_id=pick_id,
            previous_state={"kind": pick.kind, "subject_id": str(pick.release_id or pick.track_id)}, organization_id=org,
        )

    async def reorder(self, ctx: AuthContext, pick_ids: list[UUID]) -> None:
        org = await self._staff_org(ctx)
        picks = {
            p.id: p
            for p in (await self.session.execute(select(TrendingPick).where(TrendingPick.organization_id == org))).scalars()
        }
        check_order(picks, pick_ids)
        before = [str(p.id) for p in sorted(picks.values(), key=lambda p: p.position)]
        for i, pid in enumerate(pick_ids, start=1):
            picks[pid].position = i
            picks[pid].updated_by = ctx.user_id
        await self.session.flush()
        await AuditService(self.session).record_from_auth(
            ctx, action="trending.reordered", entity_type="TrendingPick", entity_id=org,
            previous_state={"order": before}, new_state={"order": [str(p) for p in pick_ids]}, organization_id=org,
        )

    # --- reads ---------------------------------------------------------------------------------

    async def _rows(self, model: Any, ids: list[UUID]) -> dict[UUID, Any]:
        ids = [i for i in ids if i is not None]
        if not ids:
            return {}
        return {r.id: r for r in (await self.session.execute(select(model).where(model.id.in_(ids)))).scalars()}

    async def _release_songs(self, release_ids: list[UUID], *, released_only: bool = True) -> dict[UUID, list[Track]]:
        out: dict[UUID, list[Track]] = {}
        if not release_ids:
            return out
        stmt = (
            select(ReleaseTrack.release_id, Track)
            .join(Track, Track.id == ReleaseTrack.track_id)
            .where(ReleaseTrack.release_id.in_(release_ids), Track.deleted_at.is_(None))
            .order_by(ReleaseTrack.release_id, ReleaseTrack.position)
        )
        if released_only:
            stmt = stmt.where(Track.status == "RELEASED")
        for release_id, track in (await self.session.execute(stmt)).all():
            out.setdefault(release_id, []).append(track)
        return out

    async def _released_on(self, track_ids: list[UUID]) -> dict[UUID, list[UUID]]:
        out: dict[UUID, list[UUID]] = {}
        if not track_ids:
            return out
        rows = await self.session.execute(
            select(ReleaseTrack.track_id, Release.id)
            .join(Release, Release.id == ReleaseTrack.release_id)
            .where(ReleaseTrack.track_id.in_(track_ids), Release.deleted_at.is_(None), Release.status == "RELEASED")
            .order_by(Release.release_at.asc().nulls_last())
        )
        for track_id, release_id in rows.all():
            out.setdefault(track_id, []).append(release_id)
        return out

    async def _listens(self, track_ids: list[UUID]) -> dict[UUID, int]:
        if not track_ids:
            return {}
        counted = dict(
            (
                await self.session.execute(
                    select(Listen.track_id, func.count()).where(Listen.track_id.in_(track_ids)).group_by(Listen.track_id)
                )
            ).all()
        )
        before = dict(
            (await self.session.execute(select(Track.id, Track.listens_before_counting).where(Track.id.in_(track_ids)))).all()
        )
        return {tid: int(counted.get(tid, 0)) + int(before.get(tid) or 0) for tid in track_ids}

    async def _durations(self, track_ids: list[UUID]) -> dict[UUID, int | None]:
        if not track_ids:
            return {}
        rows = await self.session.execute(
            select(TrackVersion.track_id, TrackVersion.duration_ms).where(
                TrackVersion.track_id.in_(track_ids), TrackVersion.is_current.is_(True)
            )
        )
        return {tid: ms for tid, ms in rows.all()}

    async def _teasers(self, track_ids: list[UUID]) -> dict[UUID, UUID]:
        """The newest published teaser per song (the same rule as release pages, D-TEASER-02)."""
        if not track_ids:
            return {}
        rows = await self.session.execute(
            select(Teaser.track_id, Teaser.id)
            .join(TeaserVersion, TeaserVersion.id == Teaser.live_version_id)
            .where(
                Teaser.track_id.in_(track_ids),
                Teaser.deleted_at.is_(None),
                Teaser.status == teaser_rules.PUBLISHED,
                TeaserVersion.status == teaser_rules.V_READY,
            )
            .order_by(Teaser.published_at.asc())
        )
        return {tid: teaser_id for tid, teaser_id in rows.all()}

    async def _sold(self, track_ids: list[UUID], release_ids: list[UUID]) -> dict[tuple[str, UUID], dict[str, int]]:
        out: dict[tuple[str, UUID], dict[str, int]] = {}
        for row in await CatalogSales(self.session).by_subject(track_ids, release_ids):
            key = (row["subject_type"], row["subject_id"])
            agg = out.setdefault(key, {"sold": 0, "refunded": 0})
            agg["sold"] += row["sold_count"]
            agg["refunded"] += row["refunded_count"]
        return out


__all__ = ["KINDS", "MAX_PICKS", "TrendingService", "check_order", "is_out"]
