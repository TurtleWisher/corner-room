"""Auth routes: register, login, logout, refresh, password, verification, Google sign-in."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field

from cornerroom.api.deps import (
    get_auth_context,
    google_oidc_dep,
    identity_service,
    require_trusted_origin,
    settings_dep,
)
from cornerroom.infra.errors import AppError, UnauthorizedError
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.identity.application import google_signin
from cornerroom.modules.identity.application.services import IdentityService
from cornerroom.modules.identity.domain.models import CustomerProfile, User
from cornerroom.modules.identity.infra.google import GoogleAuthError, GoogleOIDC

# Every state-changing auth route sets, rotates or clears the refresh cookie, so all of them get the
# CSRF origin check (Gate 1 M1). Google start/callback are top-level GETs and are unaffected.
router = APIRouter(prefix="/auth", tags=["auth"], dependencies=[Depends(require_trusted_origin)])

REFRESH_PATH = "/api/v1/auth"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class PasswordForgotRequest(BaseModel):
    email: EmailStr


class PasswordResetRequest(BaseModel):
    token: str = Field(min_length=8, max_length=256)
    new_password: str = Field(min_length=8, max_length=128)


class VerificationRequest(BaseModel):
    email: EmailStr


class VerificationCompleteRequest(BaseModel):
    token: str = Field(min_length=8, max_length=256)


class UserOut(BaseModel):
    id: UUID
    email: str | None
    status: str
    display_name: str | None = None
    locale: str | None = None
    email_verified: bool = False
    security_locked: bool = False


class RegisterResponse(BaseModel):
    user: UserOut
    verification_required: bool = True
    # "dev_mailbox" (local/dev/test), "email" (a real provider), or "not_configured" (OD-08).
    verification_delivery: str = "not_configured"
    # Local and test only: the link that verifies this account. Always None on shared servers.
    dev_verification_url: str | None = None


class VerificationRequestResponse(BaseModel):
    status: str = "accepted"
    verification_delivery: str = "not_configured"
    dev_verification_url: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    expires_at: datetime
    user: UserOut


def _user_out(user: User, profile: CustomerProfile | None) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        status=user.status,
        display_name=profile.display_name if profile else None,
        locale=profile.locale if profile else None,
        email_verified=user.email_verified_at is not None,
        security_locked=user.security_locked_at is not None,
    )


def _set_refresh_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,  # type: ignore[arg-type]
        max_age=settings.jwt_refresh_ttl_seconds,
        path=REFRESH_PATH,
        domain=settings.cookie_domain or None,
    )


def _clear_refresh_cookie(response: Response, settings: Settings) -> None:
    # Same attributes as when it was set, so browsers that require them (SameSite=None) drop it.
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path=REFRESH_PATH,
        domain=settings.cookie_domain or None,
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.cookie_samesite,  # type: ignore[arg-type]
    )


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(
    body: RegisterRequest,
    request: Request,
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> RegisterResponse:
    ip, ua = _client(request)
    user, profile = await svc.register(
        email=body.email,
        password=body.password,
        display_name=body.display_name,
        request_id=getattr(request.state, "request_id", ""),
        ip=ip,
        user_agent=ua,
    )
    link = await svc.deliver_verification(
        user, request_id=getattr(request.state, "request_id", ""), ip=ip, user_agent=ua
    )
    return RegisterResponse(
        user=_user_out(user, profile),
        verification_delivery=svc.verification_delivery(),
        dev_verification_url=link,
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    svc: Annotated[IdentityService, Depends(identity_service)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> TokenResponse:
    ip, ua = _client(request)
    user, profile, access, refresh, expires = await svc.login(
        email=body.email,
        password=body.password,
        request_id=getattr(request.state, "request_id", ""),
        ip=ip,
        user_agent=ua,
    )
    _set_refresh_cookie(response, refresh, settings)
    return TokenResponse(
        access_token=access,
        expires_in=settings.jwt_access_ttl_seconds,
        expires_at=expires,
        user=_user_out(user, profile),
    )


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    response: Response,
    svc: Annotated[IdentityService, Depends(identity_service)],
    settings: Annotated[Settings, Depends(settings_dep)],
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
) -> Response:
    token = request.cookies.get(settings.refresh_cookie_name)
    await svc.logout(token, ctx)
    _clear_refresh_cookie(response, settings)
    return Response(status_code=204)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request,
    response: Response,
    svc: Annotated[IdentityService, Depends(identity_service)],
    settings: Annotated[Settings, Depends(settings_dep)],
) -> TokenResponse:
    token = request.cookies.get(settings.refresh_cookie_name)
    if not token:
        raise UnauthorizedError("Missing refresh cookie")
    ip, ua = _client(request)
    user, access, new_refresh, expires = await svc.refresh(
        token,
        request_id=getattr(request.state, "request_id", ""),
        ip=ip,
        user_agent=ua,
    )
    _, profile = await svc.get_me(user.id)
    _set_refresh_cookie(response, new_refresh, settings)
    return TokenResponse(
        access_token=access,
        expires_in=settings.jwt_access_ttl_seconds,
        expires_at=expires,
        user=_user_out(user, profile),
    )


@router.post("/password/change", response_model=TokenResponse)
async def change_password(
    body: PasswordChangeRequest,
    request: Request,
    response: Response,
    svc: Annotated[IdentityService, Depends(identity_service)],
    settings: Annotated[Settings, Depends(settings_dep)],
    ctx: Annotated[AuthContext, Depends(get_auth_context)],
) -> TokenResponse:
    access, refresh, expires = await svc.change_password(
        ctx,
        current_password=body.current_password,
        new_password=body.new_password,
    )
    user, profile = await svc.get_me(ctx.user_id)
    _set_refresh_cookie(response, refresh, settings)
    return TokenResponse(
        access_token=access,
        expires_in=settings.jwt_access_ttl_seconds,
        expires_at=expires,
        user=_user_out(user, profile),
    )


@router.post("/password/forgot", status_code=202)
async def forgot_password(
    body: PasswordForgotRequest,
    request: Request,
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> dict[str, str]:
    ip, ua = _client(request)
    await svc.request_password_recovery(
        email=body.email,
        request_id=getattr(request.state, "request_id", ""),
        ip=ip,
        user_agent=ua,
    )
    return {"status": "accepted"}


@router.post("/password/reset", status_code=204)
async def reset_password(
    body: PasswordResetRequest,
    request: Request,
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> Response:
    ip, ua = _client(request)
    await svc.complete_password_recovery(
        token=body.token,
        new_password=body.new_password,
        request_id=getattr(request.state, "request_id", ""),
        ip=ip,
        user_agent=ua,
    )
    return Response(status_code=204)


@router.post("/verification/request", status_code=202, response_model=VerificationRequestResponse)
async def request_verification(
    body: VerificationRequest,
    request: Request,
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> VerificationRequestResponse:
    ip, ua = _client(request)
    link = await svc.request_verification(
        email=body.email,
        request_id=getattr(request.state, "request_id", ""),
        ip=ip,
        user_agent=ua,
    )
    # Same answer whether or not the address exists; the link is only ever set in local/test.
    return VerificationRequestResponse(verification_delivery=svc.verification_delivery(), dev_verification_url=link)


@router.post("/verification/complete", status_code=204)
async def complete_verification(
    body: VerificationCompleteRequest,
    request: Request,
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> Response:
    ip, ua = _client(request)
    await svc.complete_verification(
        token=body.token,
        request_id=getattr(request.state, "request_id", ""),
        ip=ip,
        user_agent=ua,
    )
    return Response(status_code=204)


# --- Continue with Google (docs/security/GOOGLE_AUTHENTICATION.md) -----------------------------
# Top-level browser navigations, not fetches: the API talks to Google server to server, sets the
# usual refresh cookie, and sends the browser back to the web app. No token is put in a URL.

_APP_ERROR_TO_GOOGLE = {
    "ACCOUNT_LOCKED": "account_locked",
    "ACCOUNT_NOT_ACTIVE": "account_not_active",
    "RATE_LIMITED": "rate_limited",
    "RATE_LIMIT_UNAVAILABLE": "provider_unavailable",
}


class AuthProvidersResponse(BaseModel):
    google: bool


@router.get("/providers", response_model=AuthProvidersResponse)
async def auth_providers(settings: Annotated[Settings, Depends(settings_dep)]) -> AuthProvidersResponse:
    """Which outside sign-in options are switched on, so the web shows only working buttons."""
    return AuthProvidersResponse(google=settings.google_enabled)


def _web_redirect(settings: Settings, path: str, **params: str) -> RedirectResponse:
    query = urlencode({k: v for k, v in params.items() if v})
    url = f"{settings.web_base_url.rstrip('/')}{path}" + (f"?{query}" if query else "")
    # 303: the browser follows with GET and does not resubmit anything.
    return RedirectResponse(url, status_code=303, headers={"Cache-Control": "no-store"})


def _google_error_redirect(settings: Settings, code: str, next_path: str | None) -> RedirectResponse:
    reason = code if code in google_signin.ERROR_CODES else "failed"
    response = _web_redirect(
        settings, "/login", google_error=reason, next=google_signin.safe_next_path(next_path)
    )
    _clear_google_state_cookie(response, settings)
    return response


def _clear_google_state_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=google_signin.STATE_COOKIE,
        path=google_signin.STATE_COOKIE_PATH,
        domain=settings.cookie_domain or None,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


@router.get("/google/start", include_in_schema=True)
async def google_start(
    request: Request,
    settings: Annotated[Settings, Depends(settings_dep)],
    oidc: Annotated[GoogleOIDC, Depends(google_oidc_dep)],
    next: Annotated[str | None, Query(max_length=512)] = None,
) -> Response:
    ip, _ = _client(request)
    try:
        started = await google_signin.start(settings=settings, oidc=oidc, next_path=next, ip=ip)
    except GoogleAuthError as exc:
        return _google_error_redirect(settings, exc.code, next)
    except AppError as exc:
        return _google_error_redirect(settings, _APP_ERROR_TO_GOOGLE.get(exc.code, "failed"), next)
    response = RedirectResponse(started.redirect_url, status_code=303, headers={"Cache-Control": "no-store"})
    # Binds this sign-in to this browser (login-CSRF defence). Lax, so Google's redirect back,
    # a top-level GET, still carries it.
    response.set_cookie(
        key=google_signin.STATE_COOKIE,
        value=started.state,
        max_age=settings.google_state_ttl_seconds,
        path=google_signin.STATE_COOKIE_PATH,
        domain=settings.cookie_domain or None,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/google/callback", include_in_schema=True)
async def google_callback(
    request: Request,
    settings: Annotated[Settings, Depends(settings_dep)],
    oidc: Annotated[GoogleOIDC, Depends(google_oidc_dep)],
    svc: Annotated[IdentityService, Depends(identity_service)],
    code: Annotated[str | None, Query(max_length=2048)] = None,
    state: Annotated[str | None, Query(max_length=256)] = None,
    error: Annotated[str | None, Query(max_length=128)] = None,
) -> Response:
    ip, ua = _client(request)
    request_id = getattr(request.state, "request_id", "")
    next_path: str | None = None
    try:
        finished = await google_signin.finish(
            settings=settings,
            oidc=oidc,
            code=code,
            state=state,
            cookie_state=request.cookies.get(google_signin.STATE_COOKIE),
            provider_error=error,
            ip=ip,
        )
        next_path = finished.next_path
        _, _, _, refresh, _ = await svc.sign_in_with_google(
            finished.identity, request_id=request_id, ip=ip, user_agent=ua
        )
    except GoogleAuthError as exc:
        if exc.code not in {"cancelled", "not_configured"}:
            await svc.record_google_failure(reason=exc.code, request_id=request_id, ip=ip, user_agent=ua)
        return _google_error_redirect(settings, exc.code, next_path or exc.next_path)
    except AppError as exc:
        return _google_error_redirect(settings, _APP_ERROR_TO_GOOGLE.get(exc.code, "failed"), next_path)
    response = _web_redirect(settings, "/auth/continue", next=finished.next_path)
    _set_refresh_cookie(response, refresh, settings)
    _clear_google_state_cookie(response, settings)
    return response
