"""Forgot password, end to end (2026-10-25): the reset link reaches the mailbox through the email
port, sets a new password once, and the answer never tells whether an address has an account."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import AsyncClient

from cornerroom.infra.settings import get_settings
from tests.auth_helpers import activate_user, register_user


@pytest.fixture
def recovery_on(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.setenv("PASSWORD_RECOVERY_TTL_SECONDS", "900")
    monkeypatch.setenv("DEV_MAILBOX_PATH", str(tmp_path))
    monkeypatch.setenv("WEB_BASE_URL", "http://localhost:3000")
    get_settings.cache_clear()
    return tmp_path / "mailbox.jsonl"


def _mail(mailbox: Path) -> list[dict]:
    if not mailbox.exists():
        return []
    return [json.loads(line) for line in mailbox.read_text(encoding="utf-8").splitlines()]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_reset_link_is_emailed_and_sets_a_new_password_once(client: AsyncClient, recovery_on: Path) -> None:
    user = await register_user(client, "forgot@example.com")
    await activate_user(client, user["id"])

    forgot = await client.post("/api/v1/auth/password/forgot", json={"email": "Forgot@Example.com"})
    assert forgot.status_code == 202
    mail = _mail(recovery_on)
    assert mail and mail[-1]["to"] == "forgot@example.com"
    body = mail[-1]["body"]
    assert "http://localhost:3000/reset-password#token=" in body, "the token must travel in the fragment"
    assert "15 minutes" in body
    token = body.split("#token=", 1)[1].split()[0]

    reset = await client.post("/api/v1/auth/password/reset", json={"token": token, "new_password": "newpassword34"})
    assert reset.status_code == 204
    replay = await client.post("/api/v1/auth/password/reset", json={"token": token, "new_password": "otherpass56"})
    assert replay.status_code == 401

    old = await client.post("/api/v1/auth/login", json={"email": "forgot@example.com", "password": "password12"})
    assert old.status_code == 401
    new = await client.post("/api/v1/auth/login", json={"email": "forgot@example.com", "password": "newpassword34"})
    assert new.status_code == 200


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_unknown_address_gets_the_same_answer_and_no_mail(client: AsyncClient, recovery_on: Path) -> None:
    unknown = await client.post("/api/v1/auth/password/forgot", json={"email": "nobody@example.com"})
    assert unknown.status_code == 202
    assert unknown.json() == {"status": "accepted"}
    assert _mail(recovery_on) == []
