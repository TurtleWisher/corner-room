"""Browser crash reports (owner, 2026-10-30, D-ERR-01).

The web app posts errors from visitors' browsers here and the API forwards them to Sentry, so the
site's security policy needs no outside address. Anyone may report (errors happen signed out too);
sizes are capped, nothing is stored, and when error tracking is off this does nothing.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from cornerroom.infra.error_tracking import capture_client_error

router = APIRouter(tags=["client-errors"])


class ClientErrorIn(BaseModel):
    kind: Literal["error", "unhandledrejection", "boundary"]
    message: str = Field(max_length=1000)
    stack: str | None = Field(default=None, max_length=8000)
    page: str | None = Field(default=None, max_length=500)
    release: str | None = Field(default=None, max_length=64)


@router.post("/client-errors", status_code=204)
async def report_client_error(body: ClientErrorIn) -> Response:
    capture_client_error(kind=body.kind, message=body.message, stack=body.stack, page=body.page, release=body.release)
    return Response(status_code=204)
