"""Search application service. Query uses existing FTS + trigram; no invented ranking."""

from __future__ import annotations

from dataclasses import dataclass
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
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.identity.application.rate_limit import enforce_auth_rate_limit
from cornerroom.modules.search.application.indexer import SearchIndexer
from cornerroom.modules.search.domain.models import SearchDocument
from cornerroom.modules.search.domain.visibility import (
    ENTITY_ARTIST,
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
        scored: list[tuple[SearchHit, float]] = []
        for row, row_rank in rows:
            if not await self._visible(ctx, row):
                continue
            scored.append((self._hit(row), float(row_rank or 0.0)))
            if len(scored) >= size + 1:
                break
        next_cursor = None
        if len(scored) > size:
            last_hit, last_rank = scored[size - 1]
            next_cursor = encode_cursor(str(last_rank), last_hit.entity_id)
            scored = scored[:size]
        return [hit for hit, _ in scored], next_cursor

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
                owner_user_id = artist.claimed_user_id
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
