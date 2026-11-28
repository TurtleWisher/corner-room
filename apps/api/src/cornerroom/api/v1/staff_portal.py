"""Staff portal: staff accounts, staff activity, the one-page overview and artists' royalty rates.

Owner, 2026-11-28 (D-STAFF-ACCOUNTS-01, D-ROYALTY-RATE-01). Thin: rules live in
modules/administration/application/staff_accounts.py, staff_portal.py and
modules/royalties/application/artist_rates.py. Every route checks permissions there or here:

- accounts: `user.admin` (admins and the owner); admins' own level: only the owner (`role.admin`)
- activity: `audit.read`
- overview: any signed-in person; each block shows only with the permission that reads it
- royalty rates: read `royalty.read`, set `royalty.run`; an act's team reads its own on /me
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, require_permission
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.administration.application.staff_accounts import StaffAccountsService
from cornerroom.modules.administration.application.staff_portal import StaffPortalService
from cornerroom.modules.royalties.application.artist_rates import ArtistRatesService

router = APIRouter(tags=["staff-portal"])

Ctx = Annotated[AuthContext, Depends(get_auth_context)]
Db = Annotated[AsyncSession, Depends(db_session)]


# ----- staff accounts ----------------------------------------------------------------------


class AccountIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    level: Literal["ADMIN", "STAFF"]
    areas: list[str] = Field(default_factory=list, max_length=40)
    note: str | None = Field(default=None, max_length=500)


class AccountChangeIn(BaseModel):
    level: Literal["ADMIN", "STAFF"]
    areas: list[str] = Field(default_factory=list, max_length=40)


@router.get("/staff/accounts", dependencies=[Depends(require_permission("user.admin"))])
async def list_accounts(ctx: Ctx, session: Db) -> dict[str, Any]:
    return await StaffAccountsService(session).list_accounts(ctx)


@router.post("/staff/accounts", status_code=201, dependencies=[Depends(require_permission("user.admin"))])
async def add_account(body: AccountIn, ctx: Ctx, session: Db) -> dict[str, Any]:
    return await StaffAccountsService(session).add(
        ctx, email=body.email, level=body.level, areas=body.areas, note=body.note
    )


@router.put("/staff/accounts/{user_id}", dependencies=[Depends(require_permission("user.admin"))])
async def change_account(user_id: UUID, body: AccountChangeIn, ctx: Ctx, session: Db) -> dict[str, Any]:
    done = await StaffAccountsService(session).change(ctx, user_id, level=body.level, areas=body.areas)
    return {"level": done.level, "areas": done.areas}


@router.delete("/staff/accounts/{user_id}", status_code=204, dependencies=[Depends(require_permission("user.admin"))])
async def remove_account(user_id: UUID, ctx: Ctx, session: Db) -> Response:
    await StaffAccountsService(session).remove(ctx, user_id)
    return Response(status_code=204)


@router.delete(
    "/staff/accounts/invites/{invite_id}", status_code=204, dependencies=[Depends(require_permission("user.admin"))]
)
async def cancel_invite(invite_id: UUID, ctx: Ctx, session: Db) -> Response:
    await StaffAccountsService(session).cancel_invite(ctx, invite_id)
    return Response(status_code=204)


@router.post("/me/staff-invite/claim")
async def claim_invite(ctx: Ctx, session: Db) -> dict[str, bool]:
    """A signed-in person picks up a staff invite waiting under their verified email, at once."""
    return {"claimed": await StaffAccountsService(session).claim_for_user(ctx.user_id)}


# ----- overview and activity -----------------------------------------------------------------


@router.get("/staff/overview")
async def overview(ctx: Ctx, session: Db) -> dict[str, Any]:
    return await StaffPortalService(session).overview(ctx)


@router.get("/staff/activity", dependencies=[Depends(require_permission("audit.read"))])
async def activity(
    ctx: Ctx,
    session: Db,
    actor: UUID | None = None,
    area: str | None = Query(default=None, max_length=40),
    q: str | None = Query(default=None, max_length=80),
    before: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    sign_ins: bool = False,
) -> dict[str, Any]:
    return await StaffPortalService(session).activity(
        ctx, actor=actor, area=area, q=q, before=before, limit=limit, include_sign_ins=sign_ins
    )


@router.get("/staff/activity/people", dependencies=[Depends(require_permission("audit.read"))])
async def activity_people(ctx: Ctx, session: Db) -> dict[str, Any]:
    return {"people": await StaffPortalService(session).activity_summary(ctx)}


# ----- royalty rates ------------------------------------------------------------------------


class RateIn(BaseModel):
    # Basis points: 7000 is 70 %. The browser turns the typed percentage into this, the server checks it.
    share_bps: int = Field(ge=0, le=10000)
    note: str | None = Field(default=None, max_length=1000)
    cover_earlier: bool = False


class RateEndIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


@router.get("/staff/royalty-rates")
async def list_rates(ctx: Ctx, session: Db, q: str | None = Query(default=None, max_length=80)) -> dict[str, Any]:
    return await ArtistRatesService(session).list_artists(ctx, q=q)


@router.get("/staff/royalty-rates/{artist_id}")
async def rate_detail(artist_id: UUID, ctx: Ctx, session: Db) -> dict[str, Any]:
    return await ArtistRatesService(session).detail(ctx, artist_id)


@router.put("/staff/royalty-rates/{artist_id}")
async def set_rate(artist_id: UUID, body: RateIn, ctx: Ctx, session: Db) -> dict[str, Any]:
    return await ArtistRatesService(session).set_rate(
        ctx, artist_id, share_bps=body.share_bps, note=body.note, cover_earlier=body.cover_earlier
    )


@router.post("/staff/royalty-rates/{artist_id}/end")
async def end_rate(artist_id: UUID, body: RateEndIn, ctx: Ctx, session: Db) -> dict[str, Any]:
    return await ArtistRatesService(session).end_rate(ctx, artist_id, note=body.note)


@router.get("/me/royalty-rates")
async def my_rates(ctx: Ctx, session: Db) -> dict[str, Any]:
    """The rate and earnings of each act this account runs (owner or manager), for Studio."""
    return {"acts": await ArtistRatesService(session).for_team_member(ctx.user_id)}
