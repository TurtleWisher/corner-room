"""Configurable auth rate limiting. Threshold 0 disables the limiter (no invented policy)."""

from __future__ import annotations

import structlog

from cornerroom.infra.errors import AppError
from cornerroom.infra.redis import get_redis, namespaced_key
from cornerroom.infra.settings import Settings

log = structlog.get_logger("auth.rate_limit")


class RateLimitedError(AppError):
    def __init__(self) -> None:
        super().__init__(
            "RATE_LIMITED",
            "Too many requests",
            429,
            "Too many authentication attempts. Try again later.",
        )


class RateLimitUnavailableError(AppError):
    def __init__(self) -> None:
        super().__init__(
            "RATE_LIMIT_UNAVAILABLE",
            "Authentication temporarily unavailable",
            503,
            "Authentication controls are unavailable.",
        )


async def enforce_auth_rate_limit(*, settings: Settings, scope: str, key: str) -> None:
    """Fail closed when the limiter is enabled and Redis cannot be reached."""
    max_attempts = settings.auth_rate_limit_max_attempts
    window = settings.auth_rate_limit_window_seconds
    if max_attempts <= 0 or window <= 0:
        return
    redis_key = namespaced_key("auth", "rl", scope, key, settings=settings)
    try:
        client = get_redis()
        current = await client.incr(redis_key)
        if current == 1:
            await client.expire(redis_key, window)
        if current > max_attempts:
            raise RateLimitedError()
    except (RateLimitedError, RateLimitUnavailableError):
        raise
    except Exception:
        log.warning("auth_rate_limit_unavailable", scope=scope)
        raise RateLimitUnavailableError() from None
