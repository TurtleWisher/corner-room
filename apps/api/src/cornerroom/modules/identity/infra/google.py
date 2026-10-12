"""Google as an OpenID Connect identity provider (authorization-code flow with PKCE).

Only proves who someone is. It asks for `openid email profile` and nothing else, never for
offline access, and keeps no Google tokens. Corner Room's User and Session stay the identity
and session of record (docs/security/GOOGLE_AUTHENTICATION.md).

Never log the authorization code, the ID token, or the client secret.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from cornerroom.infra.settings import Settings

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
SCOPES = "openid email profile"
JWKS_CACHE_SECONDS = 3600
CLOCK_SKEW_SECONDS = 60


class GoogleAuthError(Exception):
    """A sign-in that must not continue. `code` is a fixed, user-safe reason."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code
        # Where the person was heading, once known from the stored state (for the error page).
        self.next_path: str | None = None


@dataclass(frozen=True)
class GoogleIdentity:
    subject: str
    email: str | None
    email_verified: bool
    name: str | None


def new_state() -> str:
    return secrets.token_urlsafe(32)


def new_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=")
    return verifier, challenge.decode("ascii")


class GoogleOIDC:
    """Small Google client. `transport` lets tests stand in a fake Google."""

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.settings = settings
        self.transport = transport
        self._jwks: dict[str, Any] | None = None
        self._jwks_at = 0.0

    def authorization_url(self, *, state: str, nonce: str, code_challenge: str) -> str:
        query = {
            "client_id": self.settings.google_client_id,
            "redirect_uri": self.settings.google_redirect_uri,
            "response_type": "code",
            "scope": SCOPES,
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
        return f"{AUTHORIZE_URL}?{urlencode(query)}"

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self.transport, timeout=10.0)

    async def exchange_code(self, *, code: str, code_verifier: str) -> str:
        """Swap the one-time code for an ID token, server to server. Returns the raw ID token."""
        form = {
            "code": code,
            "client_id": self.settings.google_client_id,
            "client_secret": self.settings.google_client_secret or "",
            "redirect_uri": self.settings.google_redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        }
        try:
            async with self._client() as client:
                response = await client.post(TOKEN_URL, data=form, headers={"Accept": "application/json"})
        except httpx.HTTPError as exc:
            raise GoogleAuthError("provider_unavailable") from exc
        if response.status_code >= 500:
            raise GoogleAuthError("provider_unavailable")
        if response.status_code != 200:
            # Expired, reused or forged code. Google's error body is not shown or logged.
            raise GoogleAuthError("code_rejected")
        id_token = response.json().get("id_token")
        if not isinstance(id_token, str) or not id_token:
            raise GoogleAuthError("token_invalid")
        return id_token

    async def _signing_keys(self, *, refresh: bool = False) -> dict[str, Any]:
        fresh = self._jwks is not None and time.monotonic() - self._jwks_at < JWKS_CACHE_SECONDS
        if fresh and not refresh:
            return self._jwks  # type: ignore[return-value]
        try:
            async with self._client() as client:
                response = await client.get(JWKS_URL)
            response.raise_for_status()
            self._jwks = response.json()
            self._jwks_at = time.monotonic()
        except (httpx.HTTPError, ValueError) as exc:
            raise GoogleAuthError("provider_unavailable") from exc
        return self._jwks  # type: ignore[return-value]

    async def verify_id_token(self, id_token: str, *, nonce: str) -> GoogleIdentity:
        """Check signature (Google's published keys), issuer, audience, expiry and nonce."""
        try:
            header = jwt.get_unverified_header(id_token)
        except jwt.PyJWTError as exc:
            raise GoogleAuthError("token_invalid") from exc
        if header.get("alg") != "RS256" or not header.get("kid"):
            raise GoogleAuthError("token_invalid")
        key = await self._key_for(header["kid"])
        try:
            claims = jwt.decode(
                id_token,
                key=key,
                algorithms=["RS256"],
                audience=self.settings.google_client_id,
                issuer=list(ISSUERS),
                leeway=CLOCK_SKEW_SECONDS,
                options={"require": ["iss", "aud", "exp", "iat", "sub"]},
            )
        except jwt.PyJWTError as exc:
            raise GoogleAuthError("token_invalid") from exc
        if not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
            raise GoogleAuthError("token_invalid")
        subject = str(claims["sub"])
        if not subject or len(subject) > 255:
            raise GoogleAuthError("token_invalid")
        email = claims.get("email")
        return GoogleIdentity(
            subject=subject,
            email=email.strip().lower() if isinstance(email, str) and email.strip() else None,
            email_verified=claims.get("email_verified") is True,
            name=str(claims["name"]).strip()[:200] if claims.get("name") else None,
        )

    async def _key_for(self, kid: str) -> Any:
        for refresh in (False, True):  # Google rotates keys; refetch once on an unknown kid.
            jwks = await self._signing_keys(refresh=refresh)
            for jwk in jwks.get("keys", []):
                if jwk.get("kid") == kid:
                    try:
                        return jwt.PyJWK(jwk).key
                    except jwt.PyJWTError as exc:
                        raise GoogleAuthError("token_invalid") from exc
        raise GoogleAuthError("token_invalid")


_shared: GoogleOIDC | None = None


def google_oidc(settings: Settings) -> GoogleOIDC:
    """Process-wide client so the signing-key cache is shared between requests."""
    global _shared
    if _shared is None or _shared.settings is not settings:
        _shared = GoogleOIDC(settings)
    return _shared
