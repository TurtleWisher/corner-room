"""Request-id binding, access logs, and security headers."""

from __future__ import annotations

import time

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from cornerroom.infra.logging import redact_path
from cornerroom.kernel.correlation import resolve_correlation_id

log = structlog.get_logger("http")


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = resolve_correlation_id(
            request.headers.get("x-request-id"),
            request.headers.get("x-correlation-id"),
        )
        correlation_id = resolve_correlation_id(
            request.headers.get("x-correlation-id"),
            request_id,
        )
        request.state.request_id = request_id
        request.state.correlation_id = correlation_id
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            correlation_id=correlation_id,
            method=request.method,
            path=redact_path(request.url.path),
        )
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.exception("request_failed")
            raise
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Correlation-ID"] = correlation_id
        log.info(
            "request_completed",
            status_code=response.status_code,
            duration_ms=duration_ms,
            operation="http.request",
        )
        return response


# The API serves JSON, audio and redirects, never pages, so nothing it returns may run script, load
# resources or be framed (Gate 1 M9). The interactive docs (off in production) load Swagger UI.
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, hsts_max_age_seconds: int = 0) -> None:
        super().__init__(app)
        self.hsts = f"max-age={hsts_max_age_seconds}" if hsts_max_age_seconds > 0 else None

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if not request.url.path.startswith(DOCS_PATHS):
            response.headers.setdefault("Content-Security-Policy", API_CSP)
        if self.hsts:
            response.headers.setdefault("Strict-Transport-Security", self.hsts)
        return response
