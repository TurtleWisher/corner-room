"""Google ID-token checks, redirect safety, settings and log redaction (no database)."""

from __future__ import annotations

from tests.settings_helpers import PROD_HARDENING

import logging
import time
from urllib.parse import parse_qs, urlparse

import jwt
import pytest

from cornerroom.infra.logging import AccessLogQueryRedactor
from cornerroom.infra.settings import Settings
from cornerroom.modules.identity.application.google_signin import safe_next_path
from cornerroom.modules.identity.infra.google import GoogleAuthError, GoogleOIDC, new_pkce_pair
from tests.google_fake import CLIENT_ID, CLIENT_SECRET, FakeGoogle, new_key

NONCE = "the-nonce"


def _settings(**overrides: object) -> Settings:
    base = dict(
        app_env="test",
        jwt_secret="x" * 40,
        google_client_id=CLIENT_ID,
        google_client_secret=CLIENT_SECRET,
    )
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


@pytest.fixture
def fake() -> FakeGoogle:
    return FakeGoogle()


@pytest.fixture
def oidc(fake: FakeGoogle) -> GoogleOIDC:
    return GoogleOIDC(_settings(), transport=fake.transport())


@pytest.mark.asyncio
async def test_valid_token_gives_the_google_identity(fake: FakeGoogle, oidc: GoogleOIDC) -> None:
    token = fake.sign(fake.claims(sub="1234567890", email="Fan@Example.com", nonce=NONCE))
    identity = await oidc.verify_id_token(token, nonce=NONCE)
    assert identity.subject == "1234567890"
    assert identity.email == "fan@example.com"
    assert identity.email_verified is True
    assert identity.name == "Google Fan"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    [
        {"nonce": "another-nonce"},
        {"aud": "someone-elses-client"},
        {"iss": "https://evil.example"},
        {"exp": int(time.time()) - 3600, "iat": int(time.time()) - 7200},
        {"sub": None},
    ],
    ids=["nonce", "audience", "issuer", "expired", "no-subject"],
)
async def test_tampered_claims_are_refused(fake: FakeGoogle, oidc: GoogleOIDC, change: dict) -> None:
    claims = fake.claims(sub="1", email="fan@example.com", nonce=NONCE)
    claims.update(change)
    claims = {k: v for k, v in claims.items() if v is not None}
    with pytest.raises(GoogleAuthError) as exc:
        await oidc.verify_id_token(fake.sign(claims), nonce=NONCE)
    assert exc.value.code == "token_invalid"


@pytest.mark.asyncio
async def test_wrong_key_unsigned_and_garbage_tokens_are_refused(fake: FakeGoogle, oidc: GoogleOIDC) -> None:
    claims = fake.claims(sub="1", email="fan@example.com", nonce=NONCE)
    forged = fake.sign(claims, key=new_key())  # right kid, wrong key
    unknown_kid = fake.sign(claims, kid="not-a-google-key")
    unsigned = jwt.encode(claims, key=None, algorithm="none")
    hs256 = jwt.encode(claims, "s" * 40, algorithm="HS256", headers={"kid": fake.kid})
    for token in (forged, unknown_kid, unsigned, hs256, "not.a.jwt", ""):
        with pytest.raises(GoogleAuthError) as exc:
            await oidc.verify_id_token(token, nonce=NONCE)
        assert exc.value.code == "token_invalid"


@pytest.mark.asyncio
async def test_unverified_email_is_reported_not_trusted(fake: FakeGoogle, oidc: GoogleOIDC) -> None:
    token = fake.sign(fake.claims(sub="1", email="fan@example.com", nonce=NONCE, email_verified=False))
    assert (await oidc.verify_id_token(token, nonce=NONCE)).email_verified is False


@pytest.mark.asyncio
async def test_code_exchange_sends_secret_and_verifier_server_side(fake: FakeGoogle, oidc: GoogleOIDC) -> None:
    fake.issue_code("code-1", "id-token-1")
    assert await oidc.exchange_code(code="code-1", code_verifier="v" * 50) == "id-token-1"
    sent = fake.token_requests[-1]
    assert sent["client_secret"] == [CLIENT_SECRET]
    assert sent["code_verifier"] == ["v" * 50]
    with pytest.raises(GoogleAuthError) as exc:  # one-time code
        await oidc.exchange_code(code="code-1", code_verifier="v" * 50)
    assert exc.value.code == "code_rejected"
    fake.fail_token_endpoint = 503
    with pytest.raises(GoogleAuthError) as exc:
        await oidc.exchange_code(code="x", code_verifier="v" * 50)
    assert exc.value.code == "provider_unavailable"


def test_authorization_url_asks_for_identity_only() -> None:
    url = GoogleOIDC(_settings()).authorization_url(state="s", nonce="n", code_challenge="c")
    query = parse_qs(urlparse(url).query)
    assert urlparse(url).netloc == "accounts.google.com"
    assert query["scope"] == ["openid email profile"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["response_type"] == ["code"]
    assert "access_type" not in query  # never offline access / Google refresh tokens
    assert "client_secret" not in url


def test_pkce_pair_is_s256() -> None:
    import base64
    import hashlib

    verifier, challenge = new_pkce_pair()
    assert 43 <= len(verifier) <= 128
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert challenge == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("/checkout?offer=1", "/checkout?offer=1"),
        (None, "/account"),
        ("", "/account"),
        ("//evil.example", "/account"),
        ("/\\evil.example", "/account"),
        ("https://evil.example", "/account"),
        ("javascript:alert(1)", "/account"),
        ("/ok\r\nSet-Cookie: x=1", "/account"),
        ("/" + "a" * 600, "/account"),
    ],
)
def test_next_path_never_leaves_the_site(raw: str | None, expected: str) -> None:
    assert safe_next_path(raw) == expected


def test_google_settings_and_production_guards() -> None:
    assert not _settings(google_client_id="").google_enabled
    assert not _settings(google_client_secret=None).google_enabled
    assert _settings().google_enabled
    prod = dict(
        app_env="production",
        jwt_secret="p" * 48,
        cookie_secure=True,
            **PROD_HARDENING,
        cors_origins=["https://cornerroom.example"],
        web_base_url="https://cornerroom.example",
        google_redirect_uri="https://api.cornerroom.example/api/v1/auth/google/callback",
    )
    assert _settings(**prod).google_enabled
    with pytest.raises(ValueError, match="GOOGLE_REDIRECT_URI"):
        _settings(**{**prod, "google_redirect_uri": "http://api.cornerroom.example/cb"})


def test_access_log_drops_auth_query_strings() -> None:
    record = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d', (
            "127.0.0.1:5000", "GET", "/api/v1/auth/google/callback?code=SECRETCODE&state=S", "1.1", 303,
        ), None,
    )
    AccessLogQueryRedactor().filter(record)
    assert "SECRETCODE" not in record.getMessage()
    assert "/api/v1/auth/google/callback?[redacted]" in record.getMessage()
    other = logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d', (
            "127.0.0.1:5000", "GET", "/api/v1/events?page=2", "1.1", 200,
        ), None,
    )
    AccessLogQueryRedactor().filter(other)
    assert "page=2" in other.getMessage()


def test_0016_is_the_sole_head_and_purely_additive() -> None:
    from pathlib import Path

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    api_root = Path(__file__).resolve().parents[1]
    script = ScriptDirectory.from_config(Config(str(api_root / "alembic.ini")))
    # Head moved on with the audio platform (0017+); 0016 stays in the linear chain.
    assert len(script.get_heads()) == 1
    assert "0016_external_identities" in {rev.revision for rev in script.walk_revisions()}
    assert script.get_revision("0016_external_identities").down_revision == "0015_database_integrity"
    text = (api_root / "alembic" / "versions" / "0016_external_identities.py").read_text(encoding="utf-8")
    upgrade = text.split("def upgrade", 1)[1].split("def downgrade", 1)[0].upper()
    for forbidden in ("DROP ", "ALTER TABLE", "ROW LEVEL", "CREATE POLICY", "CREATE ROLE"):
        assert forbidden not in upgrade
    assert "UQ_EXTERNAL_IDENTITIES_PROVIDER_SUBJECT" in upgrade


def test_external_identity_model_matches_the_migration_constraints() -> None:
    from cornerroom.modules.identity.domain.models import ExternalIdentity

    indexes = {ix.name: ix for ix in ExternalIdentity.__table__.indexes}
    subject = indexes["uq_external_identities_provider_subject"]
    assert subject.unique and [c.name for c in subject.columns] == ["provider", "subject"]
    per_user = indexes["uq_external_identities_user_provider"]
    assert per_user.unique and [c.name for c in per_user.columns] == ["user_id", "provider"]
    assert "email" not in {c.name for c in subject.columns}  # email is never the key
