"""Honest health vocabulary. Do not treat STUB/absent vendors as HEALTHY."""

from __future__ import annotations

from typing import Any

HEALTHY = "HEALTHY"
DEGRADED = "DEGRADED"
UNAVAILABLE = "UNAVAILABLE"
NOT_CONFIGURED = "NOT_CONFIGURED"
NOT_AVAILABLE = "NOT_AVAILABLE"

EMAIL_STUB_HONESTY = "EMAIL STUB"


def probe_status(ok: bool) -> str:
    return HEALTHY if ok else UNAVAILABLE


def probe_check(ok: bool) -> dict[str, Any]:
    return {"status": probe_status(ok), "ok": ok}


def overall_status(
    *,
    database_ok: bool,
    redis_ok: bool,
    treat_email_stub_as_degraded: bool = False,
) -> str:
    if not database_ok and not redis_ok:
        return UNAVAILABLE
    if not database_ok or not redis_ok:
        return DEGRADED
    if treat_email_stub_as_degraded:
        return DEGRADED
    return HEALTHY


def public_dependency_checks(*, database_ok: bool, redis_ok: bool) -> dict[str, Any]:
    return {
        "database": probe_check(database_ok),
        "redis": probe_check(redis_ok),
        "email": {"status": NOT_CONFIGURED, "honesty": EMAIL_STUB_HONESTY},
        "sms": {"status": NOT_AVAILABLE},
        "push": {"status": NOT_AVAILABLE},
    }


def contains_secret_fragment(value: str) -> bool:
    lowered = value.lower()
    return any(
        fragment in lowered
        for fragment in (
            "password",
            "secret",
            "token",
            "jwt",
            "authorization",
            "api_key",
            "apikey",
            "private_key",
            "access_key",
            "credential",
            "pan",
            "cvv",
        )
    )
