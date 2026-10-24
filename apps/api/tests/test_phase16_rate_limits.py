"""Rate limits (owner, 2026-10-24, D-RATE-01): sign-in 10 per 15 minutes per address, downloads 30
per hour per account. Token refresh is not caught by the sign-in limit. Needs Redis, so it runs in
the database job (marked postgres)."""

from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.infra.settings import Settings


def _settings(**over) -> Settings:
    return Settings(
        app_env="test",
        jwt_secret="test-secret-not-for-production-use-please",
        redis_key_prefix=f"rl-test-{uuid4().hex[:8]}",  # fresh counters for every test
        **over,
    )


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_sign_in_limit_is_ten_per_window_per_address() -> None:
    from cornerroom.modules.identity.application.rate_limit import RateLimitedError, enforce_auth_rate_limit

    s = _settings(auth_rate_limit_max_attempts=10, auth_rate_limit_window_seconds=900)
    for _ in range(10):
        await enforce_auth_rate_limit(settings=s, scope="login", key="203.0.113.9")
    with pytest.raises(RateLimitedError) as stopped:
        await enforce_auth_rate_limit(settings=s, scope="login", key="203.0.113.9")
    assert stopped.value.status == 429
    # Another address is not affected, nor another kind of attempt from the same address.
    await enforce_auth_rate_limit(settings=s, scope="login", key="198.51.100.7")
    await enforce_auth_rate_limit(settings=s, scope="recovery", key="203.0.113.9")
    # Quiet token refresh is not caught by the sign-in limit (its own setting, off by default).
    for _ in range(30):
        await enforce_auth_rate_limit(settings=s, scope="refresh", key="203.0.113.9")


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_download_limit_is_per_account() -> None:
    from cornerroom.modules.streaming.application.downloads import DownloadService

    svc = DownloadService(None, _settings(download_rate_limit_max=30, download_rate_limit_window_seconds=3600))  # type: ignore[arg-type]
    fan, other = uuid4(), uuid4()
    for _ in range(30):
        await svc._limit(fan)
    with pytest.raises(AppError) as stopped:
        await svc._limit(fan)
    assert stopped.value.status == 429 and stopped.value.code == "RATE_LIMITED"
    await svc._limit(other)


def test_a_made_up_address_cannot_dodge_the_limit() -> None:
    """Behind nginx the API counts the real visitor address, not one the visitor wrote in a header."""
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

    seen: dict = {}

    async def app(scope, receive, send):  # noqa: ANN001
        seen["client"] = scope["client"][0]

    mw = ProxyHeadersMiddleware(app, trusted_hosts="127.0.0.1,172.16.0.0/12")

    async def call(xff: str) -> str:
        scope = {"type": "http", "client": ("172.18.0.1", 5000), "headers": [(b"x-forwarded-for", xff.encode())], "scheme": "http"}
        await mw(scope, None, None)
        return seen["client"]

    assert asyncio.run(call("6.6.6.6, 203.0.113.9")) == "203.0.113.9"
    assert asyncio.run(call("203.0.113.9")) == "203.0.113.9"
