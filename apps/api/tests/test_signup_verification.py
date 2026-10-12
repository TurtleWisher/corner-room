"""Sign-up to sign-in: the verification link is delivered through the email port, and on
local/test servers it is also handed back so the account can be activated without a provider."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import AsyncClient

from cornerroom.infra.settings import Settings, get_settings


def _token(link: str) -> str:
    assert "/verify#token=" in link, "the token must travel in the URL fragment, not the query"
    return link.split("#token=", 1)[1]


@pytest.fixture
def verification_on(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.setenv("VERIFICATION_CHALLENGE_TTL_SECONDS", "3600")
    monkeypatch.setenv("DEV_MAILBOX_PATH", str(tmp_path))
    monkeypatch.setenv("WEB_BASE_URL", "http://localhost:3000")
    get_settings.cache_clear()
    return tmp_path / "mailbox.jsonl"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_signup_verify_then_sign_in(client: AsyncClient, verification_on: Path) -> None:
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": "newfan@example.com", "password": "password12", "display_name": "New Fan"},
    )
    assert register.status_code == 201
    body = register.json()
    assert body["verification_delivery"] == "dev_mailbox"
    link = body["dev_verification_url"]
    assert link.startswith("http://localhost:3000/verify#token=")

    # The same link went through the email port to the dev mailbox.
    mail = [json.loads(line) for line in verification_on.read_text(encoding="utf-8").splitlines()]
    assert mail[-1]["to"] == "newfan@example.com"
    assert link in mail[-1]["body"]

    pending = await client.post("/api/v1/auth/login", json={"email": "newfan@example.com", "password": "password12"})
    assert pending.status_code == 403
    assert pending.json()["code"] == "ACCOUNT_NOT_ACTIVE"

    done = await client.post("/api/v1/auth/verification/complete", json={"token": _token(link)})
    assert done.status_code == 204

    login = await client.post("/api/v1/auth/login", json={"email": "newfan@example.com", "password": "password12"})
    assert login.status_code == 200
    assert login.json()["user"]["status"] == "ACTIVE"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_resend_gives_a_working_link_and_does_not_reveal_accounts(
    client: AsyncClient, verification_on: Path
) -> None:
    await client.post(
        "/api/v1/auth/register",
        json={"email": "again@example.com", "password": "password12", "display_name": "Again"},
    )
    resend = await client.post("/api/v1/auth/verification/request", json={"email": "again@example.com"})
    assert resend.status_code == 202
    link = resend.json()["dev_verification_url"]
    assert link

    unknown = await client.post("/api/v1/auth/verification/request", json={"email": "nobody@example.com"})
    assert unknown.status_code == 202
    assert unknown.json()["status"] == "accepted"
    assert unknown.json()["dev_verification_url"] is None

    assert (await client.post("/api/v1/auth/verification/complete", json={"token": _token(link)})).status_code == 204
    login = await client.post("/api/v1/auth/login", json={"email": "again@example.com", "password": "password12"})
    assert login.status_code == 200


def test_dev_links_never_leave_this_machine() -> None:
    base = dict(jwt_secret="x" * 40, sandbox_payment_secret="y" * 40)
    assert Settings(app_env="local", **base).exposes_dev_verification_link
    assert Settings(app_env="test", **base).exposes_dev_verification_link
    assert not Settings(app_env="dev", **base).exposes_dev_verification_link
    staging = Settings(app_env="staging", **base)
    assert not staging.exposes_dev_verification_link
    assert not staging.uses_dev_mailbox
