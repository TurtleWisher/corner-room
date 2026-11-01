"""Search application service. Query uses existing FTS + trigram; no invented ranking."""

from __future__ import annotations

from dataclasses import dataclass, replace
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import ForbiddenError, NotFoundError
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock
from cornerroom.kernel.events import DomainEvent
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.modules.artists.application.service import ArtistService
from cornerroom.modules.artists.application.team import acting_owner
from cornerroom.modules.artists.domain.models import Artist, Band
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.identity.application.rate_limit import enforce_auth_rate_limit
from cornerroom.modules.search.application.indexer import SearchIndexer
from cornerroom.modules.search.domain.models import SearchDocument
from cornerroom.modules.search.domain.visibility import (
    ENTITY_ARTIST,
    ENTITY_BAND,
    GUEST_ENTITY_TYPES,
    SCHEMA_ENTITY_TYPES,
    STAFF_HIT_AUTHZ,
    VISIBILITY_PUBLIC,
    VISIBILITY_STAFF_ORG,
    VISIBILITY_UNAVAILABLE,
    route_for,
    snippet_for,
)


@dataclass(frozen=True, slots=True)
class SearchHit:
    entity_type: str
    entity_id: UUID
    title: str
    subtitle: str | None
    snippet: str
    organization_id: UUID | None
    visibility: str
    route: str | None
    # An artist's or band's approved picture (its media asset id), so suggestions can show it.
    picture: UUID | None = None


def _like_pattern(q: str) -> str:
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class SearchService:
    def __init__(
        self,
        session: AsyncSession,
        clock: Clock | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.session = session
        self.indexer = SearchIndexer(session, clock=clock)
        self.authz = AuthorizationService(session, clock=clock)
        self.artists = ArtistService(session)
        self.settings = settings or get_settings()

    async def ingest_event(self, event: DomainEvent) -> SearchDocument | None:
        return await self.indexer.ingest_event(event)

    async def rebuild(self) -> int:
        return await self.indexer.rebuild()

    async def query(
        self,
        ctx: AuthContext | None,
        *,
        q: str,
        entity_type: str | None = None,
        organization_id: UUID | None = None,
        cursor: str | None = None,
        limit: int = 50,
        rate_limit_key: str = "unknown",
    ) -> tuple[list[SearchHit], str | None]:
        await enforce_auth_rate_limit(
            settings=self.settings,
            scope="search",
            key=rate_limit_key,
        )
        text = (q or "").strip()
        if not text:
            return [], None
        wanted_type = (entity_type or "").strip().upper() or None
        if wanted_type is not None and wanted_type not in SCHEMA_ENTITY_TYPES:
            return [], None
        guest_like = ctx is None or ctx.organization_id is None
        if guest_like and wanted_type is not None and wanted_type not in GUEST_ENTITY_TYPES:
            return [], None
        size = clamp_limit(limit)
        tsq = func.plainto_tsquery("simple", text)
        rank = func.ts_rank(SearchDocument.tsv, tsq)
        stmt = select(SearchDocument, rank.label("search_rank")).where(
            SearchDocument.visibility != VISIBILITY_UNAVAILABLE,
            or_(
                SearchDocument.tsv.op("@@")(tsq),
                SearchDocument.title.op("%")(text),
                SearchDocument.title.ilike(_like_pattern(text), escape="\\"),
            ),
        )
        if guest_like:
            stmt = stmt.where(
                SearchDocument.visibility == VISIBILITY_PUBLIC,
                SearchDocument.entity_type.in_(GUEST_ENTITY_TYPES),
            )
        else:
            stmt = stmt.where(
                SearchDocument.visibility.in_((VISIBILITY_PUBLIC, VISIBILITY_STAFF_ORG))
            )
        if wanted_type is not None:
            stmt = stmt.where(SearchDocument.entity_type == wanted_type)
        if organization_id is not None:
            stmt = stmt.where(SearchDocument.organization_id == organization_id)
        stmt = stmt.order_by(rank.desc(), SearchDocument.id.desc())
        if cursor:
            data = decode_cursor(cursor)
            try:
                cursor_rank = float(data["t"])
            except (TypeError, ValueError):
                cursor_rank = 0.0
            cursor_id = UUID(str(data["id"]))
            stmt = stmt.where(
                (rank < cursor_rank)
                | ((rank == cursor_rank) & (SearchDocument.id < cursor_id))
            )
        rows = list((await self.session.execute(stmt.limit(size + 20))).all())
        acts = await self._acts(rows)
        seen: set[tuple[str, UUID]] = set()
        scored: list[tuple[SearchHit, float]] = []
        for row, row_rank in rows:
            hit = self._act_hit(row, acts)
            if hit is None or (hit.entity_type, hit.entity_id) in seen:
                continue
            if not await self._visible(ctx, row):
                continue
            seen.add((hit.entity_type, hit.entity_id))
            scored.append((hit, float(row_rank or 0.0)))
            if len(scored) >= size + 1:
                break
        next_cursor = None
        if len(scored) > size:
            last_hit, last_rank = scored[size - 1]
            next_cursor = encode_cursor(str(last_rank), last_hit.entity_id)
            scored = scored[:size]
        return [hit for hit, _ in scored], next_cursor

    async def _acts(self, rows: list) -> dict[tuple[str, UUID], Artist | Band]:
        """The live artist and band rows behind the hits, in one read each (not the index's copy)."""
        artist_ids = {row.entity_id for row, _ in rows if row.entity_type == ENTITY_ARTIST}
        band_ids = {row.entity_id for row, _ in rows if row.entity_type == ENTITY_BAND}
        acts: dict[tuple[str, UUID], Artist | Band] = {}
        for entity_type, model, ids in ((ENTITY_ARTIST, Artist, artist_ids), (ENTITY_BAND, Band, band_ids)):
            if not ids:
                continue
            found = await self.session.execute(select(model).where(model.id.in_(ids)))
            for act in found.scalars():
                acts[(entity_type, act.id)] = act
        return acts

    def _act_hit(
        self, row: SearchDocument, acts: dict[tuple[str, UUID], Artist | Band]
    ) -> SearchHit | None:
        """One act appears once, with its picture (owner, 2026-11-01). A document whose artist or
        band was deleted (a solo profile moved to a band, D-BAND-01) is skipped; a band's own artist
        row (D-ARTIST-UNIFY-01) is shown as the band. A document with no row keeps its indexed copy."""
        hit = self._hit(row)
        if row.entity_type not in (ENTITY_ARTIST, ENTITY_BAND):
            return hit
        act = acts.get((row.entity_type, row.entity_id))
        if act is None:
            return hit
        if act.deleted_at is not None:
            return None
        if isinstance(act, Artist) and act.kind == "BAND":
            return replace(
                hit,
                entity_type=ENTITY_BAND,
                route=route_for(ENTITY_BAND, row.entity_id),
                picture=act.portrait_asset_id,
            )
        return replace(hit, picture=act.portrait_asset_id)

    def _hit(self, row: SearchDocument) -> SearchHit:
        return SearchHit(
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            title=row.title,
            subtitle=row.subtitle,
            snippet=snippet_for(row.title, row.searchable_text),
            organization_id=row.organization_id,
            visibility=row.visibility,
            route=route_for(row.entity_type, row.entity_id),
        )

    async def _visible(self, ctx: AuthContext | None, row: SearchDocument) -> bool:
        if row.visibility == VISIBILITY_UNAVAILABLE:
            return False
        if row.visibility == VISIBILITY_PUBLIC:
            if ctx is None or ctx.organization_id is None:
                return row.entity_type in GUEST_ENTITY_TYPES
            # USER/ORGANIZATION stay hidden until Q-P13-11. STAFF_ORG uses STAFF_HIT_AUTHZ.
            return row.entity_type in GUEST_ENTITY_TYPES or row.entity_type in STAFF_HIT_AUTHZ
        if row.visibility != VISIBILITY_STAFF_ORG:
            return False
        if ctx is None or ctx.organization_id is None:
            return False
        if row.organization_id is None or row.organization_id != ctx.organization_id:
            return False
        mapping = STAFF_HIT_AUTHZ.get(row.entity_type)
        if mapping is None:
            return False
        resource_type, permission = mapping
        owner_user_id = None
        if row.entity_type == ENTITY_ARTIST:
            try:
                artist = await self.artists.get_artist_row(row.entity_id)
                owner_user_id = await acting_owner(self.session, artist.id, ctx.user_id)
            except NotFoundError:
                owner_user_id = None
        try:
            await self.authz.authorize(
                ctx.user_id,
                permission,
                resource_type=resource_type,
                resource_id=row.entity_id,
                owner_user_id=owner_user_id,
                scope_organization_id=row.organization_id,
            )
            return True
        except ForbiddenError:
            return False
