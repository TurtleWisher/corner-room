"""Unified search. Guest PUBLIC only; staff extra hits are authz, not visibility."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from cornerroom.api.deps import get_optional_auth_context, search_service
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.search.application.service import SearchService

router = APIRouter(tags=["search"])


class SearchHitOut(BaseModel):
    entity_type: str
    entity_id: UUID
    title: str
    subtitle: str | None
    snippet: str
    organization_id: UUID | None
    visibility: str
    route: str | None


class SearchPage(BaseModel):
    items: list[SearchHitOut]
    next_cursor: str | None


@router.get("/search", response_model=SearchPage)
async def search(
    request: Request,
    svc: Annotated[SearchService, Depends(search_service)],
    ctx: Annotated[AuthContext | None, Depends(get_optional_auth_context)],
    q: str = Query(default=""),
    entity_type: str | None = Query(default=None),
    organization_id: UUID | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
) -> SearchPage:
    key = str(ctx.user_id) if ctx is not None else (
        request.client.host if request.client else "unknown"
    )
    hits, next_cursor = await svc.query(
        ctx,
        q=q,
        entity_type=entity_type,
        organization_id=organization_id,
        cursor=cursor,
        limit=limit,
        rate_limit_key=key,
    )
    return SearchPage(
        items=[
            SearchHitOut(
                entity_type=hit.entity_type,
                entity_id=hit.entity_id,
                title=hit.title,
                subtitle=hit.subtitle,
                snippet=hit.snippet,
                organization_id=hit.organization_id,
                visibility=hit.visibility,
                route=hit.route,
            )
            for hit in hits
        ],
        next_cursor=next_cursor,
    )
