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
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
    )
