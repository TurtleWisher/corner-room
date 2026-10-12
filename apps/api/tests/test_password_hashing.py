"""Password hashing: Argon2id, constant work for unknown accounts, safe on bad hashes, rehash."""

from __future__ import annotations

import time

import pytest
from argon2 import PasswordHasher
from httpx import AsyncClient

from cornerroom.infra.security import hash_password, password_needs_rehash, verify_password
from cornerroom.modules.identity.application.credentials import (
    password_hash_outdated,
    password_matches,
)


def test_hashes_are_argon2id_and_salted() -> None:
    first, second = hash_password("correct horse"), hash_password("correct horse")
    assert first.startswith("$argon2id$")
    assert first != second
    assert verify_password(first, "correct horse")
    assert not verify_password(first, "Correct horse")


def test_missing_or_malformed_hash_is_a_mismatch_not_an_error() -> None:
    for stored in (None, "", "not-a-hash", "$argon2id$garbage", "$2b$12$bcryptlookingvalue"):
        assert not password_matches(stored, "anything")
    # The dummy hash used for timing must never accept its own source phrase.
    assert not verify_password(None, "cornerroom-timing-equaliser")


def test_unknown_account_costs_a_full_verification() -> None:
    real = hash_password("password12")
    start = time.perf_counter()
    password_matches(real, "wrong-password")
    with_hash = time.perf_counter() - start
    start = time.perf_counter()
    password_matches(None, "wrong-password")
    without_hash = time.perf_counter() - start
    # Same order of magnitude; a skipped check would be ~1000x faster.
    assert without_hash > with_hash / 5


def test_outdated_parameters_are_flagged_for_rehash() -> None:
    weak = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash("password12")
    assert password_needs_rehash(weak)
    assert password_hash_outdated(weak)
    assert not password_hash_outdated(hash_password("password12"))
    assert not password_hash_outdated(None)
    assert not password_needs_rehash("not-a-hash")


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_login_upgrades_an_outdated_hash(client: AsyncClient) -> None:
    from uuid import UUID

    from sqlalchemy import select

    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.identity.domain.models import User
    from tests.auth_helpers import activate_user, register_user

    user = await register_user(client, "oldhash@example.com")
    await activate_user(client, user["id"])
    weak = PasswordHasher(time_cost=1, memory_cost=8192, parallelism=1).hash("password12")
    async with get_session_factory()() as session:
        row = (await session.execute(select(User).where(User.id == UUID(user["id"])))).scalar_one()
        row.password_hash = weak
        await session.commit()

    login = await client.post("/api/v1/auth/login", json={"email": "oldhash@example.com", "password": "password12"})
    assert login.status_code == 200

    async with get_session_factory()() as session:
        stored = (await session.execute(select(User.password_hash).where(User.id == UUID(user["id"])))).scalar_one()
    assert stored != weak
    assert not password_needs_rehash(stored)
    assert verify_password(stored, "password12")
