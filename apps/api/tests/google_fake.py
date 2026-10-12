"""A stand-in for Google's token and signing-key endpoints, for tests only.

It signs ID tokens with a locally generated RSA key and publishes that key as a JWKS, so the
real verification code runs unchanged. This is application-integration testing, NOT a check
against real Google.
"""

from __future__ import annotations

import json
import time
from typing import Any
from urllib.parse import parse_qs

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from cornerroom.modules.identity.infra.google import JWKS_URL, TOKEN_URL

CLIENT_ID = "test-client.apps.googleusercontent.com"
CLIENT_SECRET = "test-google-client-secret"


def new_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeGoogle:
    def __init__(self) -> None:
        self.key = new_key()
        self.kid = "test-kid-1"
        self.codes: dict[str, dict[str, Any]] = {}
        self.token_requests: list[dict[str, list[str]]] = []
        self.fail_token_endpoint: int | None = None

    def claims(self, *, sub: str, email: str | None, nonce: str, **extra: Any) -> dict[str, Any]:
        now = int(time.time())
        base: dict[str, Any] = {
            "iss": "https://accounts.google.com",
            "aud": CLIENT_ID,
            "sub": sub,
            "email": email,
            "email_verified": True,
            "name": "Google Fan",
            "iat": now,
            "exp": now + 3600,
            "nonce": nonce,
        }
        base.update(extra)
        return {k: v for k, v in base.items() if v is not None}

    def sign(self, claims: dict[str, Any], *, key: rsa.RSAPrivateKey | None = None, kid: str | None = None) -> str:
        return jwt.encode(claims, key or self.key, algorithm="RS256", headers={"kid": kid or self.kid})

    def issue_code(self, code: str, id_token: str) -> None:
        self.codes[code] = {"id_token": id_token}

    def jwks(self) -> dict[str, Any]:
        public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        public.update({"kid": self.kid, "use": "sig", "alg": "RS256"})
        return {"keys": [public]}

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url).split("?")[0]
        if url == JWKS_URL:
            return httpx.Response(200, json=self.jwks())
        if url == TOKEN_URL:
            form = parse_qs(request.content.decode())
            self.token_requests.append(form)
            if self.fail_token_endpoint:
                return httpx.Response(self.fail_token_endpoint, json={"error": "server_error"})
            if form.get("client_secret") != [CLIENT_SECRET] or not form.get("code_verifier"):
                return httpx.Response(401, json={"error": "invalid_client"})
            issued = self.codes.pop(form.get("code", [""])[0], None)  # one-time, like Google
            if issued is None:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"id_token": issued["id_token"], "token_type": "Bearer"})
        return httpx.Response(404)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)
