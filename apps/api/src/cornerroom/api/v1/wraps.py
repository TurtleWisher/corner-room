"""Corner Room Wrap (owner, 2026-11-28, D-WRAP-01): each person's look back at a period, and the
staff console that runs it. Thin: rules live in modules/analytics/domain/wraps.py and the service
in modules/analytics/application/wraps.py."""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, get_optional_auth_context
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.analytics.application.wraps import WrapService
from cornerroom.modules.analytics.domain import wraps as rules

router = APIRouter(tags=["wraps"])


async def wrap_service(session: AsyncSession = Depends(db_session)) -> WrapService:
    return WrapService(session)


Svc = Annotated[WrapService, Depends(wrap_service)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]
MaybeCtx = Annotated[AuthContext | None, Depends(get_optional_auth_context)]


class CountIn(BaseModel):
    kind: Literal["FINISHED", "SHARED_SHEET", "SHARED_SAVE", "SHARED_LINK", "PLAYED"]


class CreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=rules.NAME_MAX)
    starts_on: date
    ends_on: date


class WindowIn(BaseModel):
    opens_at: datetime | None = None
    closes_at: datetime | None = None


class UpdateIn(BaseModel):
    version: int
    name: str | None = Field(default=None, max_length=rules.NAME_MAX)
    starts_on: date | None = None
    ends_on: date | None = None
    # Sent whole when staff change when it opens or closes; null times clear them.
    window: WindowIn | None = None
    settings: dict[str, Any] | None = None


class TransitionIn(BaseModel):
    to: Literal["DRAFT", "LIVE", "ENDED"]


# --- fans ------------------------------------------------------------------------------------------


@router.get("/wraps")
async def list_wraps(ctx: MaybeCtx, svc: Svc) -> dict[str, Any]:
    """Wraps open now (anyone, so the page can ask guests to sign in); staff also see the rest."""
    return {"items": await svc.open_list(ctx)}


@router.get("/wraps/{season_id}")
async def my_wrap(season_id: UUID, ctx: Ctx, svc: Svc, preview: Annotated[bool, Query()] = False) -> dict[str, Any]:
    """The signed-in person's own Wrap. 404 unless it is open (or the viewer is platform staff)."""
    return await svc.read(ctx, season_id, preview=preview)


@router.post("/wraps/{season_id}/count", status_code=204)
async def count_wrap(season_id: UUID, body: CountIn, ctx: Ctx, svc: Svc) -> Response:
    """Finished, shared or played: running totals only, never who."""
    await svc.counted(ctx, season_id, body.kind)
    return Response(status_code=204)


# --- staff -----------------------------------------------------------------------------------------


@router.get("/staff/wraps")
async def staff_wraps(ctx: Ctx, svc: Svc) -> dict[str, Any]:
    """Platform admins only; anyone else gets 404."""
    return {
        "items": await svc.staff_list(ctx),
        "options": {
            "cards": list(rules.CARD_KEYS),
            "looks": list(rules.LOOKS),
            "motions": list(rules.MOTIONS),
            "dithers": list(rules.DITHERS),
            "fill_ins": list(rules.FILL_INS),
            "limits": {
                "top": [rules.TOP_MIN, rules.TOP_MAX],
                "cell": [rules.CELL_MIN, rules.CELL_MAX],
                "slide_seconds": [rules.SLIDE_MIN_S, rules.SLIDE_MAX_S],
                "period_days": rules.PERIOD_MAX_DAYS,
                "title": rules.TITLE_MAX,
                "words": rules.WORDS_MAX,
            },
        },
    }


@router.post("/staff/wraps", status_code=201)
async def create_wrap(body: CreateIn, ctx: Ctx, svc: Svc) -> dict[str, Any]:
    season = await svc.create(ctx, name=body.name, starts_on=body.starts_on, ends_on=body.ends_on)
    return await svc.staff_get(ctx, season.id)


@router.get("/staff/wraps/{season_id}")
async def staff_wrap(season_id: UUID, ctx: Ctx, svc: Svc) -> dict[str, Any]:
    view = await svc.staff_get(ctx, season_id)
    view["people_with_listens"] = await svc.people_with_activity(ctx, season_id)
    return view


@router.put("/staff/wraps/{season_id}")
async def update_wrap(season_id: UUID, body: UpdateIn, ctx: Ctx, svc: Svc) -> dict[str, Any]:
    await svc.update(
        ctx,
        season_id,
        version=body.version,
        name=body.name,
        starts_on=body.starts_on,
        ends_on=body.ends_on,
        opens_at=body.window.opens_at if body.window else None,
        closes_at=body.window.closes_at if body.window else None,
        window_sent=body.window is not None,
        settings=body.settings,
    )
    return await staff_wrap(season_id, ctx, svc)


@router.post("/staff/wraps/{season_id}/transition")
async def transition_wrap(season_id: UUID, body: TransitionIn, ctx: Ctx, svc: Svc) -> dict[str, Any]:
    await svc.transition(ctx, season_id, body.to)
    return await staff_wrap(season_id, ctx, svc)


@router.post("/staff/wraps/{season_id}/rebuild")
async def rebuild_wrap(season_id: UUID, ctx: Ctx, svc: Svc) -> dict[str, Any]:
    cleared = await svc.rebuild(ctx, season_id)
    view = await staff_wrap(season_id, ctx, svc)
    view["cleared"] = cleared
    return view


@router.delete("/staff/wraps/{season_id}", status_code=204)
async def delete_wrap(season_id: UUID, ctx: Ctx, svc: Svc) -> Response:
    await svc.remove(ctx, season_id)
    return Response(status_code=204)
