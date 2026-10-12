"""Password hashing (argon2) and JWT access tokens. Refresh tokens are opaque."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from cornerroom.infra.errors import UnauthorizedError
from cornerroom.infra.settings import Settings
from cornerroom.kernel.ids import new_uuid

# Argon2id with argon2-cffi's defaults (RFC 9106 low-memory profile: t=3, m=64 MiB, p=4).
_hasher = PasswordHasher()
# Verified when there is no stored hash, so an unknown email costs the same time as a wrong password.
_DUMMY_HASH = _hasher.hash("cornerroom-timing-equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """True only for a matching password. A missing or malformed hash is a mismatch, never a 500,
    and still spends one full Argon2 verification."""
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    """True when the stored hash uses older parameters than the current hasher."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return False


def create_access_token(
    *,
    user_id: UUID,
    settings: Settings,
    organization_id: UUID | None = None,
    session_id: UUID | None = None,
    now: datetime | None = None,
) -> tuple[str, datetime]:
    issued = now or datetime.now(timezone.utc)
    expires = issued + timedelta(seconds=settings.jwt_access_ttl_seconds)
    payload: dict[str, Any] = {
        "iss": settings.jwt_issuer,
        "sub": str(user_id),
        "org": str(organization_id) if organization_id else None,
        "sid": str(session_id) if session_id else None,
        "iat": int(issued.timestamp()),
        "exp": int(expires.timestamp()),
        "jti": str(new_uuid()),
        "token_use": "access",
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return token, expires


def decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
        )
    except jwt.PyJWTError as exc:
        raise UnauthorizedError("Invalid or expired access token") from exc
    if payload.get("token_use") != "access":
        raise UnauthorizedError("Invalid token type")
    return payload
