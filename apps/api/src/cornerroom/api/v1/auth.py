"""Auth routes: register, login, logout, refresh, password, verification."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field

from cornerroom.api.deps import get_auth_context, identity_service, settings_dep
from cornerroom.infra.errors import UnauthorizedError
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.identity.application.services import IdentityService
from cornerroom.modules.identity.domain.models import CustomerProfile, User

router = APIRouter(prefix="/auth", tags=["auth"])

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
    verification_delivery: str = "not_configured"


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
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        path=REFRESH_PATH,
        domain=settings.cookie_domain or None,
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
    return RegisterResponse(user=_user_out(user, profile))


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


@router.post("/verification/request", status_code=202)
async def request_verification(
    body: VerificationRequest,
    request: Request,
    svc: Annotated[IdentityService, Depends(identity_service)],
) -> dict[str, str]:
    ip, ua = _client(request)
    await svc.request_verification(
        email=body.email,
        request_id=getattr(request.state, "request_id", ""),
        ip=ip,
        user_agent=ua,
    )
    return {"status": "accepted"}


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
