"""Continue with Google: start and finish the OpenID Connect round trip.

State, nonce and the PKCE verifier live once in Redis (keyed by a hash of the state) and the
state is also bound to the browser by a short-lived httpOnly cookie. Finishing deletes the Redis
entry atomically, so a replayed or doubled callback is refused. The verified identity is handed
to IdentityService.sign_in_with_google, which owns users, links and sessions.
"""

from __future__ import annotations

import json
import secrets
from dataclasses import dataclass

from cornerroom.infra.redis import get_redis, namespaced_key
from cornerroom.infra.settings import Settings
from cornerroom.modules.identity.application.credentials import hash_secret
from cornerroom.modules.identity.application.rate_limit import enforce_auth_rate_limit
from cornerroom.modules.identity.infra.google import (
    GoogleAuthError,
    GoogleIdentity,
    GoogleOIDC,
    new_pkce_pair,
    new_state,
)

STATE_COOKIE = "cr_google_state"
STATE_COOKIE_PATH = "/api/v1/auth/google"
DEFAULT_NEXT = "/account"

# Reasons the web app knows how to explain. Anything else becomes "failed".
ERROR_CODES = frozenset(
    {
        "cancelled",
        "state_invalid",
        "provider_unavailable",
        "code_rejected",
        "token_invalid",
        "email_unverified",
        "link_requires_password",
        "link_conflict",
        "account_unavailable",
        "account_locked",
        "account_not_active",
        "rate_limited",
        "not_configured",
        "failed",
    }
)


def safe_next_path(value: str | None) -> str:
    """Same rule as the web's safeNextPath: a path on this site, nothing that can leave it."""
    if not value or len(value) > 512 or not value.startswith("/") or value.startswith(("//", "/\\")):
        return DEFAULT_NEXT
    if any(ord(ch) < 0x20 or ch == "\\" for ch in value):
        return DEFAULT_NEXT
    return value


def _state_key(state: str, settings: Settings) -> str:
    return namespaced_key("auth", "google", "state", hash_secret(state), settings=settings)


@dataclass(frozen=True)
class GoogleStart:
    redirect_url: str
    state: str


@dataclass(frozen=True)
class GoogleFinish:
    identity: GoogleIdentity
    next_path: str


async def start(*, settings: Settings, oidc: GoogleOIDC, next_path: str | None, ip: str | None) -> GoogleStart:
    if not settings.google_enabled:
        raise GoogleAuthError("not_configured")
    await enforce_auth_rate_limit(settings=settings, scope="google", key=ip or "unknown")
    state = new_state()
    nonce = secrets.token_urlsafe(32)
    verifier, challenge = new_pkce_pair()
    record = json.dumps({"nonce": nonce, "verifier": verifier, "next": safe_next_path(next_path)})
    try:
        await get_redis().set(_state_key(state, settings), record, ex=settings.google_state_ttl_seconds)
    except Exception as exc:  # Redis down: fail closed, never fall back to an unstored state.
        raise GoogleAuthError("provider_unavailable") from exc
    return GoogleStart(
        redirect_url=oidc.authorization_url(state=state, nonce=nonce, code_challenge=challenge),
        state=state,
    )


async def finish(
    *,
    settings: Settings,
    oidc: GoogleOIDC,
    code: str | None,
    state: str | None,
    cookie_state: str | None,
    provider_error: str | None,
    ip: str | None,
) -> GoogleFinish:
    if not settings.google_enabled:
        raise GoogleAuthError("not_configured")
    await enforce_auth_rate_limit(settings=settings, scope="google", key=ip or "unknown")
    if not state or not cookie_state or not secrets.compare_digest(state, cookie_state):
        raise GoogleAuthError("state_invalid")
    try:
        raw = await get_redis().getdel(_state_key(state, settings))
    except Exception as exc:
        raise GoogleAuthError("provider_unavailable") from exc
    if raw is None:  # expired, already used, or never issued
        raise GoogleAuthError("state_invalid")
    record = json.loads(raw)
    next_path = safe_next_path(record.get("next"))
    try:
        if provider_error:
            # access_denied = the person chose Cancel on Google's screen.
            raise GoogleAuthError("cancelled" if provider_error == "access_denied" else "failed")
        if not code:
            raise GoogleAuthError("code_rejected")
        id_token = await oidc.exchange_code(code=code, code_verifier=record["verifier"])
        identity = await oidc.verify_id_token(id_token, nonce=record["nonce"])
    except GoogleAuthError as exc:
        exc.next_path = next_path
        raise
    return GoogleFinish(identity=identity, next_path=next_path)
