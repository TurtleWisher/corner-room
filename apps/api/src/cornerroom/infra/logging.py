"""Structured JSON logs with request id and secret redaction."""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

SENSITIVE_KEY_FRAGMENTS = (
    "password",
    "secret",
    "token",
    "authorization",
    "cookie",
    "api_key",
    "apikey",
    "private_key",
    "access_key",
    "refresh",
    "credential",
    "pan",
    "cvv",
)


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(fragment in lowered for fragment in SENSITIVE_KEY_FRAGMENTS)


def redact_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: ("***" if _is_sensitive_key(str(key)) else redact_value(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    return value


def redact_processor(
    _logger: Any, _method: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    return redact_value(event_dict)


# Paths whose query strings carry one-time secrets (Google's authorization code and state).
QUERY_REDACTED_PATH_PREFIXES = ("/api/v1/auth/",)

# Paths whose last part IS a bearer secret: signed playback and download links. Anyone holding one
# can fetch the audio until it expires, so it must never reach a log line or an error body.
TOKEN_PATH_PREFIXES = ("/api/v1/playback/media/", "/api/v1/downloads/")


def mask_email(address: str | None) -> str:
    """"p***@example.com": enough to tell recipients apart while debugging, never the address."""
    if not address or "@" not in address:
        return "***"
    local, domain = address.rsplit("@", 1)
    return f"{local[:1]}***@{domain}"


def mask_phone(number: str | None) -> str:
    """"***1234": the last four digits only."""
    digits = "".join(ch for ch in (number or "") if ch.isdigit())
    return f"***{digits[-4:]}" if len(digits) >= 4 else "***"


def redact_path(path: str) -> str:
    """The path with any signed token replaced by [token]; other paths unchanged."""
    for prefix in TOKEN_PATH_PREFIXES:
        if path.startswith(prefix) and len(path) > len(prefix):
            return prefix + "[token]"
    return path


class AccessLogQueryRedactor(logging.Filter):
    """Strip query strings from uvicorn access-log lines for auth paths, so codes never reach logs,
    and signed media/download tokens from their paths."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            path = args[2]
            if "?" in path and path.startswith(QUERY_REDACTED_PATH_PREFIXES):
                path = path.split("?", 1)[0] + "?[redacted]"
            path = redact_path(path)
            if path != args[2]:
                record.args = (*args[:2], path, *args[3:])
        return True


def install_access_log_redaction() -> None:
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, AccessLogQueryRedactor) for f in access.filters):
        access.addFilter(AccessLogQueryRedactor())


def configure_logging(level: str = "INFO", *, service: str = "api", environment: str = "local") -> None:
    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.CallsiteParameterAdder(
                parameters=[structlog.processors.CallsiteParameter.MODULE]
            ),
            timestamper,
            structlog.stdlib.PositionalArgumentsFormatter(),
            redact_processor,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(service=service, environment=environment)
    install_access_log_redaction()
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
    )
