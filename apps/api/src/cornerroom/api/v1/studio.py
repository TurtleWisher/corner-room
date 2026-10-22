"""Artist Studio API: catalog-only routes for profile owners and the staff who help them.

AUDIO_PHASE_1_DESIGN 10.1. Every response model below is an allow-list of catalog fields; the
privacy tests assert their exact key sets.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, get_auth_context, settings_dep
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.music.application.studio import StudioService

router = APIRouter(tags=["studio"])


async def studio(
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> StudioService:
    return StudioService(session, settings)


StudioDep = Annotated[StudioService, Depends(studio)]
Ctx = Annotated[AuthContext, Depends(get_auth_context)]


class ProfileCardOut(BaseModel):
    kind: Literal["artist", "band"]
    id: UUID
    display_name: str
    status: str
    can_publish: bool
    reason: str | None = None


class TaxonomyRoleOut(BaseModel):
    key: str
    label_en: str
    label_bn: str | None
    performer: bool
    allows_instrument: bool


class TaxonomyItemOut(BaseModel):
    key: str
    label_en: str
    label_bn: str | None


class LanguageOut(BaseModel):
    code: str
    label_en: str
    label_bn: str


class TaxonomyOut(BaseModel):
    credit_roles: list[TaxonomyRoleOut]
    genres: list[TaxonomyItemOut]
    languages: list[LanguageOut]
    release_types: list[str]


class ReleaseCardOut(BaseModel):
    id: UUID
    title: str
    release_type: str
    status: str
    display_state: str
    track_count: int
    cover_asset_id: UUID | None
    cover_url: str | None = None
    updated_at: datetime
    version: int


class ReleaseFieldsOut(BaseModel):
    id: UUID
    title: str
    release_type: str
    status: str
    release_at: datetime | None
    release_timezone: str
    cover_asset_id: UUID | None
    language_code: str | None
    genre_primary: str | None
    genre_secondary: str | None
    label_name: str | None
    p_line: str | None
    c_line: str | None
    upc: str | None
    track_sales: str
    intake_mode: str
    rights_declared_at: datetime | None
    version: int


class AudioVersionOut(BaseModel):
    version_id: UUID
    status: str
    processing_detail: str | None
    is_current: bool
    has_audio: bool
    duration_ms: int | None


class CreditOut(BaseModel):
    id: UUID
    role_key: str
    artist_id: UUID | None
    artist_name: str | None
    display_name: str | None
    instrument: str | None
    position: int


class StudioTrackOut(BaseModel):
    id: UUID
    position: int
    title: str
    version_title: str | None
    status: str
    explicit: bool
    language_code: str | None
    genre_primary: str | None
    genre_secondary: str | None
    isrc: str | None
    version: int
    audio: list[AudioVersionOut]
    credits: list[CreditOut]


class ReadinessItemOut(BaseModel):
    code: str
    ok: bool
    track_id: UUID | None = None


class ReadinessOut(BaseModel):
    ready: bool
    items: list[ReadinessItemOut]


class ProposalOut(BaseModel):
    id: UUID
    subject_type: str
    subject_id: UUID
    audience: str
    amount_minor: int
    currency_code: str
    note: str | None
    status: str
    decision_note: str | None
    created_at: datetime


class ProfileRefOut(BaseModel):
    kind: Literal["artist", "band"]
    id: UUID
    display_name: str


class IntakeOut(BaseModel):
    mode: str
    status: str
    managed_reason: str | None
    artist_confirmed_at: datetime | None


class ReviewEventOut(BaseModel):
    action: str
    note: str | None
    from_status: str
    to_status: str
    created_at: datetime


class ReleaseDetailOut(BaseModel):
    release: ReleaseFieldsOut
    cover_url: str | None = None
    profile: ProfileRefOut
    viewer_role: Literal["owner", "staff"]
    display_state: str
    tracks: list[StudioTrackOut]
    readiness: ReadinessOut
    proposals: list[ProposalOut]
    intake: IntakeOut | None
    history: list[ReviewEventOut]


class ProfileRefIn(BaseModel):
    kind: Literal["artist", "band"]
    id: UUID


class ReleaseCreateIn(BaseModel):
    profile: ProfileRefIn
    release_type: Literal["SINGLE", "EP", "ALBUM", "COMPILATION", "LIVE"]
    title: str = Field(min_length=1, max_length=300)


class ReleasePatchIn(BaseModel):
    version: int | None = None
    title: str | None = Field(default=None, max_length=300)
    release_type: Literal["SINGLE", "EP", "ALBUM", "COMPILATION", "LIVE"] | None = None
    language_code: str | None = None
    genre_primary: str | None = None
    genre_secondary: str | None = None
    label_name: str | None = Field(default=None, max_length=200)
    p_line: str | None = Field(default=None, max_length=300)
    c_line: str | None = Field(default=None, max_length=300)
    upc: str | None = Field(default=None, max_length=14)
    release_timezone: str | None = Field(default=None, max_length=64)
    release_at: datetime | None = None
    track_sales: Literal["RELEASE_ONLY", "TRACKS_ALLOWED"] | None = None


class TrackCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)


class TrackOrderIn(BaseModel):
    track_ids: list[UUID] = Field(min_length=1, max_length=100)


class TrackPatchIn(BaseModel):
    version: int | None = None
    title: str | None = Field(default=None, max_length=300)
    version_title: str | None = Field(default=None, max_length=100)
    explicit: bool | None = None
    language_code: str | None = None
    genre_primary: str | None = None
    genre_secondary: str | None = None
    isrc: str | None = Field(default=None, max_length=15)


class CreditIn(BaseModel):
    role_key: str = Field(min_length=1, max_length=32)
    artist_id: UUID | None = None
    display_name: str | None = Field(default=None, max_length=200)
    instrument: str | None = Field(default=None, max_length=80)


class CreditsIn(BaseModel):
    credits: list[CreditIn] = Field(max_length=50)


class SubmitIn(BaseModel):
    rights_declaration: bool = False


class ProposalIn(BaseModel):
    subject_type: Literal["TRACK", "RELEASE"]
    subject_id: UUID
    audience: Literal["EVERYONE", "OWNS_PART_OF_RELEASE"] = "EVERYONE"
    amount_minor: int = Field(ge=0)
    currency_code: str = Field(default="BDT", min_length=3, max_length=3)
    note: str | None = Field(default=None, max_length=500)


class VersionCreatedOut(BaseModel):
    version_id: UUID
    status: str
    is_current: bool


def _patch(body: BaseModel) -> dict[str, Any]:
    return {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "version"}


@router.get("/me/catalog-profiles", response_model=list[ProfileCardOut])
async def my_profiles(ctx: Ctx, svc: StudioDep) -> list[ProfileCardOut]:
    return [ProfileCardOut(**p) for p in await svc.my_profiles(ctx)]


@router.get("/catalog/taxonomy", response_model=TaxonomyOut)
async def taxonomy(_ctx: Ctx, svc: StudioDep) -> TaxonomyOut:
    return TaxonomyOut(**await svc.taxonomy())


@router.get("/studio/profiles/{kind}/{profile_id}/releases", response_model=list[ReleaseCardOut])
async def profile_releases(kind: Literal["artist", "band"], profile_id: UUID, ctx: Ctx, svc: StudioDep) -> list[ReleaseCardOut]:
    return [ReleaseCardOut(**r) for r in await svc.list_releases(ctx, kind, profile_id)]


@router.post("/studio/releases", response_model=ReleaseDetailOut, status_code=201)
async def create_release(body: ReleaseCreateIn, ctx: Ctx, svc: StudioDep) -> ReleaseDetailOut:
    release = await svc.create_release(ctx, kind=body.profile.kind, pid=body.profile.id, release_type=body.release_type, title=body.title)
    return ReleaseDetailOut(**await svc.release_detail(ctx, release.id))


@router.get("/studio/releases/{release_id}", response_model=ReleaseDetailOut)
async def release_detail(release_id: UUID, ctx: Ctx, svc: StudioDep) -> ReleaseDetailOut:
    return ReleaseDetailOut(**await svc.release_detail(ctx, release_id))


@router.patch("/studio/releases/{release_id}", response_model=ReleaseDetailOut)
async def update_release(release_id: UUID, body: ReleasePatchIn, ctx: Ctx, svc: StudioDep) -> ReleaseDetailOut:
    await svc.update_release(ctx, release_id, _patch(body), body.version)
    return ReleaseDetailOut(**await svc.release_detail(ctx, release_id))


@router.get("/studio/releases/{release_id}/readiness", response_model=ReadinessOut)
async def readiness(release_id: UUID, ctx: Ctx, svc: StudioDep) -> ReadinessOut:
    release, _role = await svc._release(ctx, release_id)
    return ReadinessOut(**await svc.readiness(release))


@router.post("/studio/releases/{release_id}/tracks", response_model=ReleaseDetailOut, status_code=201)
async def add_track(release_id: UUID, body: TrackCreateIn, ctx: Ctx, svc: StudioDep) -> ReleaseDetailOut:
    await svc.add_track(ctx, release_id, body.title)
    return ReleaseDetailOut(**await svc.release_detail(ctx, release_id))


@router.put("/studio/releases/{release_id}/tracks/order", response_model=ReleaseDetailOut)
async def reorder(release_id: UUID, body: TrackOrderIn, ctx: Ctx, svc: StudioDep) -> ReleaseDetailOut:
    await svc.reorder_tracks(ctx, release_id, body.track_ids)
    return ReleaseDetailOut(**await svc.release_detail(ctx, release_id))


@router.delete("/studio/releases/{release_id}/tracks/{track_id}", status_code=204)
async def remove_track(release_id: UUID, track_id: UUID, ctx: Ctx, svc: StudioDep) -> Response:
    await svc.remove_track(ctx, release_id, track_id)
    return Response(status_code=204)


@router.patch("/studio/tracks/{track_id}", response_model=StudioTrackOut)
async def update_track(track_id: UUID, body: TrackPatchIn, ctx: Ctx, svc: StudioDep) -> StudioTrackOut:
    track = await svc.update_track(ctx, track_id, _patch(body), body.version)
    _t, release, _role = await svc._track(ctx, track_id)
    position = next(p for p, t in await svc._tracks_of(release.id) if t.id == track.id)
    return StudioTrackOut(**await svc._track_view(track, position))


@router.put("/studio/tracks/{track_id}/credits", response_model=StudioTrackOut)
async def set_credits(track_id: UUID, body: CreditsIn, ctx: Ctx, svc: StudioDep) -> StudioTrackOut:
    await svc.set_credits(ctx, track_id, [c.model_dump() for c in body.credits])
    track, release, _role = await svc._track(ctx, track_id)
    position = next(p for p, t in await svc._tracks_of(release.id) if t.id == track.id)
    return StudioTrackOut(**await svc._track_view(track, position))


@router.post("/studio/tracks/{track_id}/versions", response_model=VersionCreatedOut, status_code=201)
async def new_version(track_id: UUID, ctx: Ctx, svc: StudioDep) -> VersionCreatedOut:
    v = await svc.new_version(ctx, track_id)
    return VersionCreatedOut(version_id=v.id, status=v.status, is_current=v.is_current)


@router.post("/studio/releases/{release_id}/submit", response_model=ReleaseDetailOut)
async def submit(release_id: UUID, body: SubmitIn, ctx: Ctx, svc: StudioDep) -> ReleaseDetailOut:
    await svc.submit(ctx, release_id, rights_declaration=body.rights_declaration)
    return ReleaseDetailOut(**await svc.release_detail(ctx, release_id))


@router.post("/studio/releases/{release_id}/withdraw", response_model=ReleaseDetailOut)
async def withdraw(release_id: UUID, ctx: Ctx, svc: StudioDep) -> ReleaseDetailOut:
    await svc.withdraw(ctx, release_id)
    return ReleaseDetailOut(**await svc.release_detail(ctx, release_id))


@router.post("/studio/releases/{release_id}/price-proposals", response_model=ProposalOut, status_code=201)
async def propose(release_id: UUID, body: ProposalIn, ctx: Ctx, svc: StudioDep) -> ProposalOut:
    p = await svc.propose_price(
        ctx, release_id, subject_type=body.subject_type, subject_id=body.subject_id, audience=body.audience,
        amount_minor=body.amount_minor, currency_code=body.currency_code, note=body.note,
    )
    return ProposalOut(**svc._proposal_view(p))


# --- Cover checks ------------------------------------------------------------------------------


class CoverFindingOut(BaseModel):
    code: str
    severity: str
    measured: str | None
    limit: str | None


class CoverReportOut(BaseModel):
    filename: str
    uploaded_at: datetime | None
    asset_status: str | None
    outcome: str | None
    width_px: int | None
    height_px: int | None
    findings: list[CoverFindingOut]
    is_current: bool


@router.get("/studio/releases/{release_id}/cover-report", response_model=CoverReportOut | None)
async def cover_report(release_id: UUID, ctx: Ctx, svc: StudioDep) -> CoverReportOut | None:
    report = await svc.cover_report(ctx, release_id)
    return CoverReportOut(**report) if report is not None else None


# --- Sales (owners and finance staff; no buyer identity) ---------------------------------------


class SalesTotalOut(BaseModel):
    currency_code: str
    sold_count: int
    refunded_count: int
    gross_amount_minor: int
    refunded_amount_minor: int
    net_amount_minor: int


class SalesItemOut(SalesTotalOut):
    subject_type: Literal["TRACK", "RELEASE"]
    subject_id: UUID
    title: str
    release_type: str | None
    last_sold_at: datetime


class SalesOut(BaseModel):
    profile: ProfileRefOut
    totals: list[SalesTotalOut]
    items: list[SalesItemOut]


class SaleLineOut(BaseModel):
    id: UUID
    subject_type: Literal["TRACK", "RELEASE"]
    subject_id: UUID
    title: str
    release_type: str | None
    quantity: int
    amount_minor: int
    refunded_amount_minor: int
    currency_code: str
    order_status: str
    ordered_at: datetime


class SaleLinePage(BaseModel):
    items: list[SaleLineOut]
    next_cursor: str | None


@router.get("/studio/profiles/{kind}/{profile_id}/sales", response_model=SalesOut)
async def profile_sales(kind: Literal["artist", "band"], profile_id: UUID, ctx: Ctx, svc: StudioDep) -> SalesOut:
    return SalesOut(**await svc.sales(ctx, kind, profile_id))


@router.get("/studio/profiles/{kind}/{profile_id}/sales/lines", response_model=SaleLinePage)
async def profile_sale_lines(
    kind: Literal["artist", "band"],
    profile_id: UUID,
    ctx: Ctx,
    svc: StudioDep,
    cursor: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=100)] = None,
) -> SaleLinePage:
    return SaleLinePage(**await svc.sales_lines(ctx, kind, profile_id, cursor=cursor, limit=limit))


# --- Staff catalog intake (music.intake_assist / music.intake_manage) ---------------------------


class StaffProfileCardOut(BaseModel):
    kind: Literal["artist", "band"]
    id: UUID
    display_name: str
    status: str
    has_owner: bool


class IntakeQueueItemOut(BaseModel):
    id: UUID
    title: str
    release_type: str
    status: str
    display_state: str
    track_count: int
    cover_asset_id: UUID | None
    cover_url: str | None = None
    updated_at: datetime
    version: int
    profile_name: str
    intake_mode: str
    preparer_count: int


class ManagedIn(BaseModel):
    enabled: bool
    reason: str | None = Field(default=None, max_length=1000)


@router.get("/catalog-intake/profiles", response_model=list[StaffProfileCardOut])
async def staff_profiles(ctx: Ctx, svc: StudioDep, q: str | None = None) -> list[StaffProfileCardOut]:
    return [StaffProfileCardOut(**p) for p in await svc.staff_profiles(ctx, q)]


@router.get("/catalog-intake/queue", response_model=list[IntakeQueueItemOut])
async def intake_queue(ctx: Ctx, svc: StudioDep, in_review: bool = False) -> list[IntakeQueueItemOut]:
    return [IntakeQueueItemOut(**r) for r in await svc.intake_queue(ctx, in_review=in_review)]


@router.post("/catalog-intake/releases/{release_id}/managed", response_model=IntakeOut)
async def set_managed(release_id: UUID, body: ManagedIn, ctx: Ctx, svc: StudioDep) -> IntakeOut:
    intake = await svc.set_managed(ctx, release_id, enabled=body.enabled, reason=body.reason)
    return IntakeOut(mode=intake.mode, status=intake.status, managed_reason=intake.managed_reason, artist_confirmed_at=intake.artist_confirmed_at)


class ReviewIn(BaseModel):
    action: Literal["start_review", "approve", "request_changes", "schedule", "release", "takedown"]
    note: str | None = Field(default=None, max_length=2000)
    release_at: datetime | None = None
    # Takedowns only (D-AUDIO-14): STANDARD keeps buyers' access, LEGAL removes it for everyone.
    takedown_kind: Literal["STANDARD", "LEGAL"] | None = None


@router.post("/catalog-intake/releases/{release_id}/review", response_model=ReleaseFieldsOut)
async def review_release(
    release_id: UUID,
    body: ReviewIn,
    ctx: Ctx,
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> ReleaseFieldsOut:
    from cornerroom.modules.music.application.review import ReviewService

    release = await ReviewService(session, settings).act(
        ctx, release_id, action=body.action, note=body.note, release_at=body.release_at, takedown_kind=body.takedown_kind
    )
    return ReleaseFieldsOut(**StudioService._release_fields(release))
