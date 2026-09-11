"""Credential boundary. Passwords live on User per 03_; this module owns hashing policy."""

from __future__ import annotations

import hashlib
import secrets

from cornerroom.infra.security import hash_password, verify_password


def hash_secret(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def hash_user_password(password: str) -> str:
    return hash_password(password)


def password_matches(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        return False
    return verify_password(password_hash, password)
