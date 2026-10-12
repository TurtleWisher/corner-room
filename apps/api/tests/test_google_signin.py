"""Continue with Google, end to end through the API with a fake Google (local RSA key + JWKS).

Application integration only: the real Google OAuth flow is NOT verified here.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from cornerroom.infra.settings import get_settings
from tests.auth_helpers import activate_user, admin_token, bearer, register_user
from tests.google_fake import CLIENT_ID, CLIENT_SECRET, FakeGoogle

WEB = "http://localhost:3000"


@pytest.fixture
def google(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> FakeGoogle:
    from cornerroom.api.deps import google_oidc_dep
    from cornerroom.modules.identity.infra.google import GoogleOIDC

    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", CLIENT_SECRET)
    monkeypatch.setenv("WEB_BASE_URL", WEB)
    get_settings.cache_clear()
    fake = FakeGoogle()
    app = client._transport.app  # type: ignore[attr-defined]
    app.dependency_overrides[google_oidc_dep] = lambda: GoogleOIDC(get_settings(), transport=fake.transport())
    yield fake
    app.dependency_overrides.pop(google_oidc_dep, None)


async def _start(client: AsyncClient, next_path: str | None = "/checkout?offer=1") -> dict[str, str]:
    params = {"next": next_path} if next_path is not None else {}
    response = await client.get("/api/v1/auth/google/start", params=params)
    assert response.status_code == 303, response.text
    location = urlparse(response.headers["location"])
    assert location.netloc == "accounts.google.com"
    query = {k: v[0] for k, v in parse_qs(location.query).items()}
    assert client.cookies.get("cr_google_state") == query["state"]
    return query


async def _callback(client: AsyncClient, **params: str):
    return await client.get("/api/v1/auth/google/callback", params=params)


def _where(response) -> tuple[str, dict[str, str]]:
    assert response.status_code == 303, response.text
    loc = urlparse(response.headers["location"])
    return f"{loc.scheme}://{loc.netloc}{loc.path}", {k: v[0] for k, v in parse_qs(loc.query).items()}


async def _google_sign_in(
    client: AsyncClient,
    google: FakeGoogle,
    *,
    sub: str = "google-sub-1",
    email: str | None = "gfan@example.com",
    tweak: Callable[[dict], None] | None = None,
    next_path: str | None = "/checkout?offer=1",
):
    started = await _start(client, next_path)
    claims = google.claims(sub=sub, email=email, nonce=started["nonce"])
    if tweak:
        tweak(claims)
    code = f"code-{sub}-{started['state'][:8]}"
    google.issue_code(code, google.sign(claims))
    return await _callback(client, code=code, state=started["state"]), code, started


async def _access_token(client: AsyncClient) -> str:
    refreshed = await client.post("/api/v1/auth/refresh")
    assert refreshed.status_code == 200, refreshed.text
    return refreshed.json()["access_token"]


async def _counts(email: str, sub: str) -> tuple[int, int]:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.identity.domain.models import ExternalIdentity, User

    async with get_session_factory()() as session:
        users = await session.scalar(select(func.count()).select_from(User).where(User.email == email))
        links = await session.scalar(
            select(func.count()).select_from(ExternalIdentity).where(ExternalIdentity.subject == sub)
        )
    return int(users or 0), int(links or 0)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_providers_reports_google_only_when_configured(client: AsyncClient) -> None:
    off = await client.get("/api/v1/auth/providers")
    assert off.json() == {"google": False}
    start = await client.get("/api/v1/auth/google/start")
    where, query = _where(start)
    assert query["google_error"] == "not_configured"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_new_google_user_gets_an_active_customer_account(client: AsyncClient, google: FakeGoogle) -> None:
    assert (await client.get("/api/v1/auth/providers")).json() == {"google": True}
    response, code, _ = await _google_sign_in(client, google)
    where, query = _where(response)
    assert where == f"{WEB}/auth/continue"
    assert query == {"next": "/checkout?offer=1"}
    # No token, code or state in the URL handed to the browser.
    assert code not in response.headers["location"]
    assert "token" not in response.headers["location"]
    # The ordinary Corner Room refresh cookie was set; the state cookie was cleared.
    assert client.cookies.get("cr_refresh")
    assert not client.cookies.get("cr_google_state")

    me = await client.get("/api/v1/me", headers=bearer(await _access_token(client)))
    body = me.json()
    assert body["email"] == "gfan@example.com"
    assert body["status"] == "ACTIVE"
    assert body["email_verified"] is True
    assert body["display_name"] == "Google Fan"
    assert body["organization_id"] is None
    assert await _counts("gfan@example.com", "google-sub-1") == (1, 1)

    # Same authorization as a password-registered customer: identical permissions, no staff access.
    password_user = await register_user(client, "pwfan@example.com")
    await activate_user(client, password_user["id"])
    login = await client.post("/api/v1/auth/login", json={"email": "pwfan@example.com", "password": "password12"})
    password_me = await client.get("/api/v1/me", headers=bearer(login.json()["access_token"]))
    assert sorted(body["permissions"]) == sorted(password_me.json()["permissions"])
    google_token = await _access_token(client)
    staff_only = await client.get("/api/v1/audit", headers=bearer(google_token))
    assert staff_only.status_code in {403, 404}


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_google_only_account_has_no_password(client: AsyncClient, google: FakeGoogle) -> None:
    await _google_sign_in(client, google, sub="nopw", email="nopw@example.com")
    for guess in ("", "password12", "cornerroom-timing-equaliser"):
        login = await client.post("/api/v1/auth/login", json={"email": "nopw@example.com", "password": guess or "x"})
        assert login.status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_same_google_account_is_the_same_user(client: AsyncClient, google: FakeGoogle) -> None:
    first, _, _ = await _google_sign_in(client, google, sub="same-sub", email="same@example.com")
    first_me = (await client.get("/api/v1/me", headers=bearer(await _access_token(client)))).json()
    # Google later reports a different email for the same account: the subject decides, not email.
    second, _, _ = await _google_sign_in(client, google, sub="same-sub", email="renamed@example.com")
    assert _where(second)[0] == f"{WEB}/auth/continue"
    second_me = (await client.get("/api/v1/me", headers=bearer(await _access_token(client)))).json()
    assert first_me["id"] == second_me["id"]
    assert await _counts("same@example.com", "same-sub") == (1, 1)
    assert await _counts("renamed@example.com", "same-sub") == (0, 1)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_replayed_callback_is_refused_and_creates_nothing(client: AsyncClient, google: FakeGoogle) -> None:
    response, code, started = await _google_sign_in(client, google, sub="replay", email="replay@example.com")
    assert _where(response)[0] == f"{WEB}/auth/continue"
    client.cookies.set("cr_google_state", started["state"], path="/api/v1/auth/google")
    again = await _callback(client, code=code, state=started["state"])
    assert _where(again)[1]["google_error"] == "state_invalid"
    assert await _counts("replay@example.com", "replay") == (1, 1)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_state_must_match_this_browser(client: AsyncClient, google: FakeGoogle) -> None:
    started = await _start(client)
    google.issue_code("c1", google.sign(google.claims(sub="s", email="s@example.com", nonce=started["nonce"])))
    forged = await _callback(client, code="c1", state="attacker-state")
    assert _where(forged)[1]["google_error"] == "state_invalid"
    client.cookies.clear()
    no_cookie = await _callback(client, code="c1", state=started["state"])
    assert _where(no_cookie)[1]["google_error"] == "state_invalid"
    assert await _counts("s@example.com", "s") == (0, 0)


@pytest.mark.postgres
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tweak", "reason"),
    [
        (lambda c: c.update(nonce="wrong"), "token_invalid"),
        (lambda c: c.update(aud="other-client"), "token_invalid"),
        (lambda c: c.update(email_verified=False), "email_unverified"),
        (lambda c: c.pop("email"), "email_unverified"),
    ],
    ids=["nonce", "audience", "unverified-email", "no-email"],
)
async def test_bad_identities_are_refused(client: AsyncClient, google: FakeGoogle, tweak, reason: str) -> None:
    response, _, _ = await _google_sign_in(client, google, sub="bad", email="bad@example.com", tweak=tweak)
    where, query = _where(response)
    assert where == f"{WEB}/login"
    assert query["google_error"] == reason
    assert query["next"] == "/checkout?offer=1"
    assert not client.cookies.get("cr_refresh")
    assert await _counts("bad@example.com", "bad") == (0, 0)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_cancel_on_google_is_a_clean_cancel(client: AsyncClient, google: FakeGoogle) -> None:
    started = await _start(client)
    response = await _callback(client, state=started["state"], error="access_denied")
    assert _where(response)[1]["google_error"] == "cancelled"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_links_an_existing_verified_account(client: AsyncClient, google: FakeGoogle, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("VERIFICATION_CHALLENGE_TTL_SECONDS", "3600")
    monkeypatch.setenv("DEV_MAILBOX_PATH", str(tmp_path))
    get_settings.cache_clear()
    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": "linkme@example.com", "password": "password12", "display_name": "Link Me"},
    )
    token = reg.json()["dev_verification_url"].split("#token=")[1]
    assert (await client.post("/api/v1/auth/verification/complete", json={"token": token})).status_code == 204
    user_id = reg.json()["user"]["id"]

    response, _, _ = await _google_sign_in(client, google, sub="link-sub", email="linkme@example.com")
    assert _where(response)[0] == f"{WEB}/auth/continue"
    me = (await client.get("/api/v1/me", headers=bearer(await _access_token(client)))).json()
    assert me["id"] == user_id
    assert me["display_name"] == "Link Me"  # existing profile kept, not overwritten by Google
    assert await _counts("linkme@example.com", "link-sub") == (1, 1)
    # The password still works after linking.
    login = await client.post("/api/v1/auth/login", json={"email": "linkme@example.com", "password": "password12"})
    assert login.status_code == 200


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_never_links_an_unverified_account(client: AsyncClient, google: FakeGoogle) -> None:
    squatter = await register_user(client, "victim@example.com")  # someone else's address, unverified
    response, _, _ = await _google_sign_in(client, google, sub="victim-sub", email="victim@example.com")
    assert _where(response)[1]["google_error"] == "link_requires_password"
    assert await _counts("victim@example.com", "victim-sub") == (1, 0)
    admin = await admin_token(client)
    user = await client.get(f"/api/v1/users/{squatter['id']}", headers=bearer(admin))
    assert user.json()["status"] == "PENDING_VERIFICATION"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_suspended_account_stays_suspended(client: AsyncClient, google: FakeGoogle) -> None:
    await _google_sign_in(client, google, sub="sus-sub", email="sus@example.com")
    me = (await client.get("/api/v1/me", headers=bearer(await _access_token(client)))).json()
    admin = await admin_token(client)
    suspended = await client.post(
        f"/api/v1/users/{me['id']}/lifecycle", headers=bearer(admin), json={"action": "suspend"}
    )
    assert suspended.status_code == 200, suspended.text
    client.cookies.clear()
    response, _, _ = await _google_sign_in(client, google, sub="sus-sub", email="sus@example.com")
    assert _where(response)[1]["google_error"] == "account_not_active"
    assert not client.cookies.get("cr_refresh")
    user = await client.get(f"/api/v1/users/{me['id']}", headers=bearer(admin))
    assert user.json()["status"] == "SUSPENDED"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_suspended_account_is_not_linked(client: AsyncClient, google: FakeGoogle) -> None:
    existing = await register_user(client, "held@example.com")
    await activate_user(client, existing["id"])
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.identity.domain.models import User

    async with get_session_factory()() as session:
        row = await session.get(User, UUID(existing["id"]))
        row.status = "SUSPENDED"
        row.email_verified_at = func.now()
        await session.commit()
    response, _, _ = await _google_sign_in(client, google, sub="held-sub", email="held@example.com")
    assert _where(response)[1]["google_error"] == "account_not_active"
    assert await _counts("held@example.com", "held-sub") == (1, 0)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_next_cannot_redirect_off_site(client: AsyncClient, google: FakeGoogle) -> None:
    for evil in ("//evil.example/x", "https://evil.example", "/\\evil.example"):
        response, _, _ = await _google_sign_in(client, google, sub="redir", email="redir@example.com", next_path=evil)
        where, query = _where(response)
        assert where == f"{WEB}/auth/continue"
        assert query["next"] == "/account"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_simultaneous_first_sign_ins_make_one_user(client: AsyncClient, google: FakeGoogle) -> None:
    other = AsyncClient(transport=client._transport, base_url="http://test")  # a second browser tab
    try:
        a = await _start(client)
        b = await _start(other)
        for name, started in (("ca", a), ("cb", b)):
            claims = google.claims(sub="race-sub", email="race@example.com", nonce=started["nonce"])
            google.issue_code(name, google.sign(claims))
        ra, rb = await asyncio.gather(
            _callback(client, code="ca", state=a["state"]),
            _callback(other, code="cb", state=b["state"]),
        )
        assert _where(ra)[0] == f"{WEB}/auth/continue", ra.headers["location"]
        assert _where(rb)[0] == f"{WEB}/auth/continue", rb.headers["location"]
        assert await _counts("race@example.com", "race-sub") == (1, 1)
    finally:
        await other.aclose()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_logout_ends_only_the_corner_room_session(client: AsyncClient, google: FakeGoogle) -> None:
    await _google_sign_in(client, google, sub="out-sub", email="out@example.com")
    token = await _access_token(client)
    calls_before = len(google.token_requests)
    out = await client.post("/api/v1/auth/logout", headers=bearer(token))
    assert out.status_code in {200, 204}
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401
    assert len(google.token_requests) == calls_before  # nothing is sent to Google on logout


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_failures_are_audited_without_secrets(client: AsyncClient, google: FakeGoogle) -> None:
    response, code, _ = await _google_sign_in(
        client, google, sub="audit-sub", email="audit@example.com", tweak=lambda c: c.update(nonce="x")
    )
    assert _where(response)[1]["google_error"] == "token_invalid"
    admin = await admin_token(client)
    audit = await client.get("/api/v1/audit", headers=bearer(admin), params={"entity_type": "User"})
    failed = [i for i in audit.json()["items"] if i["action"] == "auth.login_failed"]
    assert any((i.get("new_state") or {}).get("reason") == "google:token_invalid" for i in failed)
    assert code not in audit.text
    assert "id_token" not in audit.text
