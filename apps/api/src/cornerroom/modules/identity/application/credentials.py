"""Credential boundary. Passwords live on User per 03_; this module owns hashing policy."""

from __future__ import annotations

import hashlib
import secrets

from cornerroom.infra.security import hash_password, password_needs_rehash, verify_password


def hash_secret(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def hash_user_password(password: str) -> str:
    return hash_password(password)


def password_matches(password_hash: str | None, password: str) -> bool:
    # Always runs one Argon2 verification, even with no stored hash (no timing hint).
    return verify_password(password_hash, password)


def password_hash_outdated(password_hash: str | None) -> bool:
    return bool(password_hash) and password_needs_rehash(password_hash)  # type: ignore[arg-type]
