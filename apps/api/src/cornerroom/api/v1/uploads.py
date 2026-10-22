"""Thin upload session API. Masters and ID docs stay gated."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field

from cornerroom.api.deps import db_session, get_auth_context, settings_dep
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.infra.errors import AppError
from cornerroom.modules.documents.application.service import DocumentService
from cornerroom.modules.documents.application.uploads import UploadService, intent_view
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/uploads", tags=["uploads"])


class UploadSessionIn(BaseModel):
    storage_class: str = Field(default="public_media")
    filename: str = Field(min_length=1, max_length=255)
    mime: str = Field(default="application/octet-stream")


class UploadSessionOut(BaseModel):
    id: UUID
    storage_class: str
    object_key: str
    status: str
    put_url: str


class UploadCompleteOut(BaseModel):
    id: UUID
    status: str
    sha256: str
    byte_size: int


@router.post("/sessions", response_model=UploadSessionOut, status_code=201)
async def create_session(
    body: UploadSessionIn,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> UploadSessionOut:
    asset, put_url = await DocumentService(session, settings).create_upload_session(
        ctx,
        storage_class=body.storage_class,
        filename=body.filename,
        mime=body.mime,
    )
    return UploadSessionOut(
        id=asset.id,
        storage_class=asset.storage_class,
        object_key=asset.object_key,
        status=asset.status,
        put_url=put_url,
    )


@router.post("/{asset_id}/complete", response_model=UploadCompleteOut)
async def complete(
    asset_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
    file: UploadFile = File(...),
) -> UploadCompleteOut:
    limit = settings.media_cover_max_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise AppError("UPLOAD_TOO_LARGE", "File too large", 422, f"The limit is {limit} bytes")
    asset = await DocumentService(session, settings).complete_upload(
        ctx, asset_id=asset_id, data=data
    )
    return UploadCompleteOut(
        id=asset.id,
        status=asset.status,
        sha256=asset.sha256,
        byte_size=asset.byte_size,
    )


# --- Resumable upload intents (audio masters, cover art). AUDIO_PHASE_1_DESIGN section 6. ---


class IntentIn(BaseModel):
    purpose: str = Field(pattern="^(AUDIO_MASTER|COVER_ART)$")
    target_type: str = Field(pattern="^(track_version|release_cover|event_cover)$")
    target_id: UUID
    filename: str = Field(min_length=1, max_length=255)
    byte_size: int = Field(gt=0)
    sha256: str | None = Field(default=None, min_length=64, max_length=64)


class IntentOut(BaseModel):
    id: UUID
    media_asset_id: UUID
    purpose: str
    target_type: str
    target_id: UUID
    filename: str
    byte_size: int
    part_size: int
    part_count: int
    parts_received: list[int]
    status: str
    expires_at: datetime
    mode: str
    resumed: bool = False


class PartsOut(BaseModel):
    parts_received: list[int]


class IntentCompleteOut(BaseModel):
    intent: IntentOut
    media_asset_id: UUID
    asset_status: str
    byte_size: int
    sha256: str


@router.post("/intents", response_model=IntentOut, status_code=201)
async def create_intent(
    body: IntentIn,
    response: Response,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> IntentOut:
    svc = UploadService(session, settings)
    intent, resumed = await svc.create_intent(
        ctx,
        purpose=body.purpose,
        target_type=body.target_type,
        target_id=body.target_id,
        filename=body.filename,
        byte_size=body.byte_size,
        sha256=body.sha256,
    )
    received = (await svc.get_intent(ctx, intent.id))[1] if resumed else []
    if resumed:
        response.status_code = 200
    return IntentOut(**intent_view(intent, received), resumed=resumed)


@router.get("/intents/open", response_model=IntentOut | None)
async def find_open_intent(
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
    target_type: str = Query(pattern="^(track_version|release_cover|event_cover)$"),
    target_id: UUID = Query(),
) -> IntentOut | None:
    found = await UploadService(session, settings).find_open(ctx, target_type, target_id)
    if found is None:
        return None
    intent, received = found
    return IntentOut(**intent_view(intent, received), resumed=True)


@router.get("/intents/{intent_id}", response_model=IntentOut)
async def get_intent(
    intent_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> IntentOut:
    intent, received = await UploadService(session, settings).get_intent(ctx, intent_id)
    return IntentOut(**intent_view(intent, received))


@router.put("/intents/{intent_id}/parts/{part_number}", response_model=PartsOut)
async def put_part(
    intent_id: UUID,
    part_number: int,
    request: Request,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
    part_sha256: Annotated[str | None, Header(alias="X-Part-SHA256")] = None,
) -> PartsOut:
    received = await UploadService(session, settings).put_part(
        ctx, intent_id, part_number, request.stream(), part_sha256
    )
    return PartsOut(parts_received=received)


@router.post("/intents/{intent_id}/complete", response_model=IntentCompleteOut)
async def complete_intent(
    intent_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> IntentCompleteOut:
    svc = UploadService(session, settings)
    intent, asset, problem = await svc.complete(ctx, intent_id)
    if problem is not None:
        await session.commit()  # keep the rejection; the client gets the reason below
        raise AppError(problem, "The uploaded file did not match what was declared", 422)
    return IntentCompleteOut(
        intent=IntentOut(**intent_view(intent, [])),
        media_asset_id=asset.id,
        asset_status=asset.status,
        byte_size=asset.byte_size,
        sha256=asset.sha256,
    )


@router.delete("/intents/{intent_id}", response_model=IntentOut)
async def cancel_intent(
    intent_id: UUID,
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> IntentOut:
    intent = await UploadService(session, settings).cancel(ctx, intent_id)
    return IntentOut(**intent_view(intent, []))
