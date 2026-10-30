"""Error tracking (owner, 2026-10-30, D-ERR-01: Sentry cloud). Off without SENTRY_DSN; when on,
no personal data or credentials leave the server."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from cornerroom.infra import error_tracking
from cornerroom.infra.error_tracking import REMOVED, init_error_tracking, scrub


def test_off_without_a_dsn() -> None:
    assert init_error_tracking("", environment="test", service="api") is False
    assert init_error_tracking("   ", environment="test", service="api") is False


def test_scrub_removes_personal_data_and_credentials() -> None:
    event = {
        "user": {"id": "u1", "email": "fan@example.com"},
        "message": "order failed for fan@example.com",
        "request": {
            "url": "https://www.cornerroom.live/api/v1/playback/media/eyJhbGciOiJIUzI1NiJ9abcdefghijklmnopqrstuvwxyz0123?sig=x",
            "query_string": "token=abc",
            "data": {"password": "hunter2"},
            "cookies": {"cr_refresh": "abc"},
            "headers": {"Authorization": "Bearer abc", "Cookie": "a=b", "User-Agent": "Firefox"},
        },
        "extra": {"recipient_name": "Nadia", "phone": "+8801712345678", "nested": {"api_token": "x", "count": 3}},
        "exception": {"values": [{"type": "ValueError", "value": "bad email nadia@example.com"}]},
        "breadcrumbs": {"values": [{"message": "GET /x for a@b.co", "data": {"url": "/api/v1/downloads/" + "a" * 40 + "?t=1"}}]},
    }
    out = scrub(event)
    assert "user" not in out
    assert "fan@example.com" not in str(out) and "nadia@example.com" not in str(out) and "a@b.co" not in str(out)
    assert out["request"]["url"] == f"https://www.cornerroom.live/api/v1/playback/media/{REMOVED}"
    assert "query_string" not in out["request"] and "data" not in out["request"] and "cookies" not in out["request"]
    assert out["request"]["headers"] == {"Authorization": REMOVED, "Cookie": REMOVED, "User-Agent": "Firefox"}
    assert out["extra"] == {"recipient_name": REMOVED, "phone": REMOVED, "nested": {"api_token": REMOVED, "count": 3}}
    assert out["breadcrumbs"]["values"][0]["data"]["url"] == f"/api/v1/downloads/{REMOVED}"


def _app():
    from cornerroom.infra.settings import Settings
    from cornerroom.main import create_app

    return create_app(Settings(app_env="test", jwt_secret="test-secret-not-for-production-use-please"), enable_lifespan=False)


@pytest.mark.asyncio
async def test_browser_reports_are_accepted_and_forwarded_only_when_on(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[dict] = []
    from cornerroom.api.v1 import client_errors

    monkeypatch.setattr(client_errors, "capture_client_error", lambda **kw: seen.append(kw))
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        ok = await client.post("/api/v1/client-errors", json={"kind": "error", "message": "x is undefined", "page": "/releases/1"})
        assert ok.status_code == 204
        assert seen == [{"kind": "error", "message": "x is undefined", "stack": None, "page": "/releases/1", "release": None}]
        too_long = await client.post("/api/v1/client-errors", json={"kind": "error", "message": "m" * 1001})
        assert too_long.status_code == 422
        odd = await client.post("/api/v1/client-errors", json={"kind": "other", "message": "m"})
        assert odd.status_code == 422


def test_capture_does_nothing_while_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(error_tracking, "_enabled", False)
    # Would raise if it tried to import or call Sentry with nothing configured.
    error_tracking.capture_client_error(kind="error", message="m", stack=None, page=None, release=None)


def test_on_with_a_dsn_uses_the_scrubber_and_no_personal_data(monkeypatch: pytest.MonkeyPatch) -> None:
    sentry_sdk = pytest.importorskip("sentry_sdk")
    monkeypatch.setenv("SENTRY_RELEASE", "abc1234")
    try:
        assert init_error_tracking("https://public@o0.ingest.sentry.io/0", environment="test", service="api") is True
        options = sentry_sdk.get_client().options
        assert options["before_send"] is scrub
        assert options["send_default_pii"] is False and options["include_local_variables"] is False
        assert options["max_request_body_size"] == "never" and options["release"] == "abc1234"
    finally:
        sentry_sdk.get_client().close()
        monkeypatch.setattr(error_tracking, "_enabled", False)
