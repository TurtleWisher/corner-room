"""Credential boundary. Passwords live on User per 03_; this module owns hashing policy."""

from __future__ import annotations

import asyncio
import hashlib
import secrets

from cornerroom.infra.security import hash_password, password_needs_rehash, verify_password


def hash_secret(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


# Argon2id takes tens of milliseconds and 64 MiB per call; it runs in a worker thread so one sign-in
# never stalls every other request on the event loop (deploy readiness, 2026-10-23).
async def hash_user_password(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)


async def password_matches(password_hash: str | None, password: str) -> bool:
    # Always runs one Argon2 verification, even with no stored hash (no timing hint).
    return await asyncio.to_thread(verify_password, password_hash, password)


def password_hash_outdated(password_hash: str | None) -> bool:
    return bool(password_hash) and password_needs_rehash(password_hash)  # type: ignore[arg-type]
