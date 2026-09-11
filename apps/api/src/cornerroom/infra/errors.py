"""Consistent problem+json errors. No stack traces in responses."""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = structlog.get_logger("errors")


class AppError(Exception):
    def __init__(
        self,
        code: str,
        title: str,
        status: int,
        detail: str | None = None,
        extras: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.title = title
        self.status = status
        self.detail = detail or title
        self.extras = extras or {}
        super().__init__(self.detail)


class UnauthorizedError(AppError):
    def __init__(self, detail: str = "Authentication required") -> None:
        super().__init__("UNAUTHENTICATED", "Unauthenticated", 401, detail)


class ForbiddenError(AppError):
    def __init__(self, detail: str = "Not permitted") -> None:
        super().__init__("FORBIDDEN", "Forbidden", 403, detail)


class NotFoundError(AppError):
    def __init__(self, detail: str = "Not found") -> None:
        super().__init__("NOT_FOUND", "Not found", 404, detail)


class ConflictError(AppError):
    def __init__(self, detail: str = "Conflict") -> None:
        super().__init__("CONFLICT", "Conflict", 409, detail)


class ResidencyGateError(AppError):
    def __init__(self, detail: str = "Storage class blocked until a cloud region is named") -> None:
        super().__init__("RESIDENCY_GATE", "Residency gate", 403, detail)


def problem(
    *,
    status: int,
    code: str,
    title: str,
    detail: str,
    request_id: str | None,
    instance: str | None = None,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "type": f"https://cornerroom.local/problems/{code.lower().replace('_', '-')}",
        "title": title,
        "status": status,
        "code": code,
        "detail": detail,
        "instance": instance,
        "request_id": request_id,
        "correlation_id": request_id,
    }
    if extras:
        body.update(extras)
    return body


def _request_id(request: Request) -> str | None:
    return (
        getattr(request.state, "correlation_id", None)
        or getattr(request.state, "request_id", None)
        or request.headers.get("x-correlation-id")
        or request.headers.get("x-request-id")
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status,
            content=problem(
                status=exc.status,
                code=exc.code,
                title=exc.title,
                detail=exc.detail,
                request_id=_request_id(request),
                instance=str(request.url.path),
                extras=exc.extras,
            ),
            media_type="application/problem+json",
        )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=problem(
                status=422,
                code="VALIDATION_ERROR",
                title="Validation Error",
                detail="Request failed validation",
                request_id=_request_id(request),
                instance=str(request.url.path),
                extras={"errors": exc.errors()},
            ),
            media_type="application/problem+json",
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        title = "Not found" if exc.status_code == 404 else "Request failed"
        return JSONResponse(
            status_code=exc.status_code,
            content=problem(
                status=exc.status_code,
                code=code,
                title=title,
                detail=str(exc.detail),
                request_id=_request_id(request),
                instance=str(request.url.path),
            ),
            media_type="application/problem+json",
        )

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", error_code="INTERNAL_ERROR")
        return JSONResponse(
            status_code=500,
            content=problem(
                status=500,
                code="INTERNAL_ERROR",
                title="Internal Error",
                detail="An unexpected error occurred",
                request_id=_request_id(request),
                instance=str(request.url.path),
            ),
            media_type="application/problem+json",
        )
