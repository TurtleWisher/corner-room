"""Phase 15 Gate 4: API and infrastructure security (Gate 1 findings M1, M7, M9, M11, M12).

Unit tests, no database. OPEN items stay open and are not tested as decided: rate-limit numbers
(Q-P14-07), webhook timestamp window (Q-P15-02), audit/outbox scoping (Q-P15-04, Q-P14-14).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.requests import Request

from cornerroom.api.deps import identity_service
from cornerroom.infra.errors import UnauthorizedError
from cornerroom.infra.settings import Settings
from cornerroom.main import create_app

WEB = "http://localhost:3000"
TEST_SECRET = "test-secret-not-for-production-use-please"
PROD = dict(
    app_env="production",
    jwt_secret="a-sufficiently-long-production-secret!!",
    ticket_signing_secret="a-different-long-ticket-signing-secret!!",
    media_token_secret="a-third-long-media-token-signing-secret!!",
    cookie_secure=True,
    allowed_hosts=["api.example.com"],
)


class _NoCookieIdentity:
    """Stands in for IdentityService: a refresh that gets past the origin check fails on the token."""

    async def refresh(self, *_args, **_kwargs):
        raise UnauthorizedError("Invalid refresh token")


def _client(**overrides) -> TestClient:
    settings = Settings(app_env="test", jwt_secret=TEST_SECRET, cors_origins=[WEB], **overrides)
    app = create_app(settings, enable_lifespan=False)
    app.dependency_overrides[identity_service] = lambda: _NoCookieIdentity()
    return TestClient(app)


# --- M7: separate signing secrets -----------------------------------------------------------


def test_production_accepts_three_distinct_secrets() -> None:
    settings = Settings(**PROD)
    assert settings.ticket_secret == PROD["ticket_signing_secret"]
    assert settings.media_secret == PROD["media_token_secret"]


@pytest.mark.parametrize("missing", ["ticket_signing_secret", "media_token_secret"])
def test_production_requires_each_signing_secret(missing: str) -> None:
    with pytest.raises(ValidationError, match=missing.upper()):
        Settings(**{**PROD, missing: None})


def test_production_rejects_short_signing_secret() -> None:
    with pytest.raises(ValidationError, match="TICKET_SIGNING_SECRET"):
        Settings(**{**PROD, "ticket_signing_secret": "short"})


@pytest.mark.parametrize("reused", ["ticket_signing_secret", "media_token_secret"])
def test_production_rejects_reused_secret(reused: str) -> None:
    with pytest.raises(ValidationError, match="must all differ"):
        Settings(**{**PROD, reused: PROD["jwt_secret"]})


def test_local_signing_secrets_fall_back_to_jwt_secret() -> None:
    settings = Settings(app_env="local", jwt_secret=TEST_SECRET)
    assert settings.ticket_secret == TEST_SECRET
    assert settings.media_secret == TEST_SECRET


def test_ticket_and_audio_tokens_use_their_own_secret(tmp_path) -> None:
    from uuid import uuid4

    import jwt

    from cornerroom.infra.storage import LocalObjectStorage
    from cornerroom.modules.streaming.application.delivery import ObjectStorageAudioDelivery
    from cornerroom.modules.ticketing.application.tokens import ticket_token, verify_ticket_token

    settings = Settings(**PROD)
    ticket_id = uuid4()
    signed = ticket_token(ticket_id, settings.ticket_secret)
    assert verify_ticket_token(signed, settings.ticket_secret) == ticket_id
    assert verify_ticket_token(signed, settings.jwt_secret) is None

    adapter = ObjectStorageAudioDelivery(settings, LocalObjectStorage(str(tmp_path)))
    minted = adapter.mint(
        user_id=uuid4(), track_id=uuid4(), track_version_id=uuid4(), media_asset_id=uuid4(),
        object_key="k",
    )
    token = minted.url.rsplit("/", 1)[-1]
    assert adapter.parse_token(token)["token_use"]
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], issuer=settings.jwt_issuer)


# --- Cookie flags and hosts -----------------------------------------------------------------


def test_samesite_must_be_a_known_value() -> None:
    with pytest.raises(ValidationError, match="COOKIE_SAMESITE"):
        Settings(app_env="test", jwt_secret=TEST_SECRET, cookie_samesite="sometimes")


def test_samesite_none_requires_secure_cookie() -> None:
    with pytest.raises(ValidationError, match="COOKIE_SECURE"):
        Settings(app_env="test", jwt_secret=TEST_SECRET, cookie_samesite="none", cookie_secure=False)
    assert Settings(app_env="test", jwt_secret=TEST_SECRET, cookie_samesite="None", cookie_secure=True).cookie_samesite == "none"


def test_production_requires_named_allowed_hosts() -> None:
    with pytest.raises(ValidationError, match="ALLOWED_HOSTS"):
        Settings(**{**PROD, "allowed_hosts": ["*"]})


def test_allowed_hosts_accepts_comma_list() -> None:
    settings = Settings(app_env="test", jwt_secret=TEST_SECRET, allowed_hosts="api.example.com, healthcheck.railway.app")
    assert settings.allowed_hosts == ["api.example.com", "healthcheck.railway.app"]


def test_trusted_host_rejects_unknown_host() -> None:
    client = _client(allowed_hosts=["api.example.com"])
    assert client.get("/health/live", headers={"host": "api.example.com"}).status_code == 200
    assert client.get("/health/live", headers={"host": "evil.example.net"}).status_code == 400


# --- M9: security headers -------------------------------------------------------------------


def test_api_responses_carry_csp_and_no_hsts_over_http() -> None:
    response = _client().get("/health/live")
    assert response.headers["content-security-policy"].startswith("default-src 'none'")
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "strict-transport-security" not in response.headers


def test_docs_are_not_blocked_by_api_csp() -> None:
    response = _client().get("/docs")
    assert response.status_code == 200
    assert "content-security-policy" not in response.headers


def test_hsts_sent_when_cookies_are_secure() -> None:
    response = _client(cookie_secure=True).get("/health/live")
    assert response.headers["strict-transport-security"] == "max-age=31536000"
    off = _client(cookie_secure=True, hsts_max_age_seconds=0).get("/health/live")
    assert "strict-transport-security" not in off.headers


# --- M12: CORS allowlist of methods and headers ---------------------------------------------


def _preflight(client: TestClient, method: str, headers: str) -> object:
    return client.options(
        "/api/v1/me",
        headers={
            "origin": WEB,
            "access-control-request-method": method,
            "access-control-request-headers": headers,
        },
    )


def test_cors_allows_what_the_web_app_sends() -> None:
    response = _preflight(_client(), "POST", "authorization,content-type,idempotency-key,x-request-id")
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == WEB
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_refuses_unlisted_header_and_method() -> None:
    client = _client()
    assert _preflight(client, "POST", "x-evil-header").status_code == 400
    assert _preflight(client, "TRACE", "content-type").status_code == 400


def test_cors_exposes_correlation_id() -> None:
    response = _client().get("/health/live", headers={"origin": WEB})
    exposed = response.headers["access-control-expose-headers"].lower()
    assert "x-correlation-id" in exposed


def test_cors_refuses_unknown_origin() -> None:
    response = _client().options(
        "/api/v1/me",
        headers={"origin": "https://evil.example.net", "access-control-request-method": "GET"},
    )
    assert "access-control-allow-origin" not in response.headers


# --- M1: CSRF origin check on cookie-carrying auth routes -----------------------------------


@pytest.mark.parametrize(
    "headers",
    [
        {"origin": "https://evil.example.net"},
        {"origin": "null"},
        {"sec-fetch-site": "cross-site"},
    ],
)
def test_refresh_from_another_site_is_blocked(headers: dict[str, str]) -> None:
    response = _client().post("/api/v1/auth/refresh", headers=headers, cookies={"cr_refresh": "x"})
    assert response.status_code == 403
    assert response.json()["code"] == "ORIGIN_NOT_ALLOWED"


@pytest.mark.parametrize(
    "headers",
    [
        {"origin": WEB},
        {"origin": "http://testserver"},
        {"sec-fetch-site": "same-site"},
        {},
    ],
)
def test_refresh_from_web_app_or_non_browser_passes_the_check(headers: dict[str, str]) -> None:
    response = _client().post("/api/v1/auth/refresh", headers=headers, cookies={"cr_refresh": "x"})
    # Past the origin check; fails only because the fake refresh token is not real.
    assert response.status_code == 401


def test_login_from_another_site_is_blocked() -> None:
    response = _client().post(
        "/api/v1/auth/login",
        headers={"origin": "https://evil.example.net"},
        json={"email": "fan@example.com", "password": "x"},
    )
    assert response.status_code == 403


def test_safe_auth_routes_ignore_origin() -> None:
    response = _client().get("/api/v1/auth/providers", headers={"origin": "https://evil.example.net"})
    assert response.status_code == 200


# --- M11: client address behind a trusted proxy ---------------------------------------------


def test_forwarded_for_ignored_by_default() -> None:
    settings = Settings(app_env="test", jwt_secret=TEST_SECRET)
    app = create_app(settings, enable_lifespan=False)

    @app.get("/_ip")
    async def _ip(request: Request) -> dict:
        return {"ip": request.client.host if request.client else None}

    body = TestClient(app).get("/_ip", headers={"x-forwarded-for": "203.0.113.9"}).json()
    assert body["ip"] != "203.0.113.9"


def test_forwarded_for_trusted_when_configured() -> None:
    settings = Settings(app_env="test", jwt_secret=TEST_SECRET, forwarded_allow_ips="*")
    app = create_app(settings, enable_lifespan=False)

    @app.get("/_ip")
    async def _ip(request: Request) -> dict:
        return {"ip": request.client.host if request.client else None, "scheme": request.url.scheme}

    body = TestClient(app).get(
        "/_ip", headers={"x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https"}
    ).json()
    assert body == {"ip": "203.0.113.9", "scheme": "https"}
