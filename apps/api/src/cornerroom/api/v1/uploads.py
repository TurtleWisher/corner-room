"""Thin upload session API. Masters and ID docs stay gated."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel, Field

from cornerroom.api.deps import db_session, get_auth_context, settings_dep
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.documents.application.service import DocumentService
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
    data = await file.read()
    asset = await DocumentService(session, settings).complete_upload(
        ctx, asset_id=asset_id, data=data
    )
    return UploadCompleteOut(
        id=asset.id,
        status=asset.status,
        sha256=asset.sha256,
        byte_size=asset.byte_size,
    )
