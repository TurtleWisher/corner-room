"""Media processing queue for operators (media.ops). AUDIO_PHASE_1_DESIGN 10.3."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.api.deps import db_session, require_permission, settings_dep
from cornerroom.infra.settings import Settings
from cornerroom.modules.documents.application.media_jobs import MediaJobService
from cornerroom.modules.documents.domain.models import MediaJob
from cornerroom.modules.identity.domain.models import User

router = APIRouter(prefix="/media-jobs", tags=["media"])


class MediaJobOut(BaseModel):
    id: UUID
    media_asset_id: UUID
    kind: str
    profile_key: str | None
    status: str
    attempts: int
    max_attempts: int
    last_error_code: str | None
    next_attempt_at: datetime
    updated_at: datetime


class MediaJobPage(BaseModel):
    items: list[MediaJobOut]


def _out(job: MediaJob) -> MediaJobOut:
    return MediaJobOut(
        id=job.id,
        media_asset_id=job.media_asset_id,
        kind=job.kind,
        profile_key=job.profile_key,
        status=job.status,
        attempts=job.attempts,
        max_attempts=job.max_attempts,
        last_error_code=job.last_error_code,
        next_attempt_at=job.next_attempt_at,
        updated_at=job.updated_at,
    )


@router.get("", response_model=MediaJobPage)
async def list_media_jobs(
    _: Annotated[User, Depends(require_permission("media.ops"))],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
    status: str | None = Query(default=None, pattern="^(QUEUED|RUNNING|SUCCEEDED|FAILED|DEAD|CANCELLED)$"),
) -> MediaJobPage:
    jobs = await MediaJobService(session, settings).list_jobs((status,) if status else ())
    return MediaJobPage(items=[_out(j) for j in jobs])


@router.post("/{job_id}/retry", response_model=MediaJobOut)
async def retry_media_job(
    job_id: UUID,
    user: Annotated[User, Depends(require_permission("media.ops"))],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> MediaJobOut:
    return _out(await MediaJobService(session, settings).retry(job_id, user.id))


@router.post("/{job_id}/cancel", response_model=MediaJobOut)
async def cancel_media_job(
    job_id: UUID,
    user: Annotated[User, Depends(require_permission("media.ops"))],
    session: Annotated[AsyncSession, Depends(db_session)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> MediaJobOut:
    return _out(await MediaJobService(session, settings).cancel(job_id, user.id))
