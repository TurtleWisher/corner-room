"""Error tracking (owner, 2026-10-30, D-ERR-01: Sentry cloud).

Off unless SENTRY_DSN is set. When on, the API, the worker and the browser (through
POST /api/v1/client-errors, so the site's security policy stays as it is) report crashes to Sentry.

Personal data never leaves: no request bodies, cookies, local variables or user details are
sent, and `scrub` removes anything under a key that looks like an email, phone, address, name,
password, token or secret, plus long token-like pieces of URLs (signed media links).
"""

from __future__ import annotations

import os
import re
from typing import Any

REMOVED = "[removed]"
# Keys whose values are personal data or credentials, matched as substrings (case-insensitive).
SENSITIVE = (
    "password", "passwd", "secret", "token", "authorization", "cookie", "session", "csrf",
    "email", "phone", "mobile", "address", "recipient", "postcode", "display_name", "legal_name",
    "card", "account_number", "transaction_id", "otp", "code_verifier", "dsn",
)
# Signed links and opaque ids in paths: 32 or more URL-safe characters in one segment.
_TOKENISH = re.compile(r"[A-Za-z0-9_\-.~%]{32,}")
_EMAIL = re.compile(r"[^\s@/]+@[^\s@/]+\.[A-Za-z]{2,}")

_enabled = False


def _sensitive(key: object) -> bool:
    text = str(key).lower()
    return any(word in text for word in SENSITIVE)


def _clean_text(value: str) -> str:
    return _EMAIL.sub(REMOVED, value)


def _clean_url(url: str) -> str:
    # Keep the path only (query strings carry tokens), with long token-like segments removed.
    path = url.split("?", 1)[0].split("#", 1)[0]
    return _TOKENISH.sub(REMOVED, path)


def _walk(value: Any, depth: int = 0) -> Any:
    if depth > 12:
        return REMOVED
    if isinstance(value, dict):
        return {k: (REMOVED if _sensitive(k) else _walk(v, depth + 1)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_walk(v, depth + 1) for v in value]
    if isinstance(value, str):
        return _clean_text(value)
    return value


def scrub(event: dict[str, Any], _hint: Any = None) -> dict[str, Any]:
    """Sentry `before_send`: strip personal data and credentials from an event."""
    event.pop("user", None)
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("cookies", "data", "query_string", "env"):
            request.pop(key, None)
        if isinstance(request.get("url"), str):
            request["url"] = _clean_url(request["url"])
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {k: (REMOVED if _sensitive(k) else v) for k, v in headers.items()}
    for key in ("extra", "contexts", "tags"):
        if key in event:
            event[key] = _walk(event[key])
    for crumb in (event.get("breadcrumbs") or {}).get("values", []) if isinstance(event.get("breadcrumbs"), dict) else []:
        if isinstance(crumb, dict):
            if isinstance(crumb.get("message"), str):
                crumb["message"] = _clean_text(crumb["message"])
            if "data" in crumb:
                crumb["data"] = _walk(crumb["data"])
            if isinstance((crumb.get("data") or {}).get("url"), str):
                crumb["data"]["url"] = _clean_url(crumb["data"]["url"])
    if isinstance(event.get("message"), str):
        event["message"] = _clean_text(event["message"])
    for exc in (event.get("exception") or {}).get("values", []) if isinstance(event.get("exception"), dict) else []:
        if isinstance(exc, dict) and isinstance(exc.get("value"), str):
            exc["value"] = _clean_text(exc["value"])
    return event


def init_error_tracking(dsn: str, *, environment: str, service: str) -> bool:
    """Start Sentry when a DSN is configured. Returns whether it is on."""
    global _enabled
    if not dsn.strip():
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn.strip(),
        environment=environment,
        release=os.environ.get("SENTRY_RELEASE") or None,
        server_name=service,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        traces_sample_rate=0.0,
        before_send=scrub,
    )
    sentry_sdk.set_tag("service", service)
    _enabled = True
    return True


def enabled() -> bool:
    return _enabled


def capture_client_error(*, kind: str, message: str, stack: str | None, page: str | None, release: str | None) -> None:
    """Report an error from a visitor's browser (already size-limited by the API schema)."""
    if not _enabled:
        return
    import sentry_sdk

    with sentry_sdk.new_scope() as scope:
        scope.set_tag("service", "web")
        scope.set_tag("kind", kind)
        if release:
            scope.set_tag("web_release", release[:64])
        scope.set_context("browser_error", {"page": _clean_url(page or ""), "stack": _clean_text(stack or "")})
        sentry_sdk.capture_message(f"Browser: {_clean_text(message)}", level="error")
