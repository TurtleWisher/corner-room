"""FastAPI dependencies: session, actor, authorize."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.db import get_session
from cornerroom.infra.errors import UnauthorizedError
from cornerroom.infra.security import decode_access_token
from cornerroom.infra.settings import Settings, get_settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.ports import NullNotificationPort
from cornerroom.modules.analytics.application.service import AnalyticsService
from cornerroom.modules.artists.application.service import ArtistService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.campaigns.application.service import CampaignService
from cornerroom.modules.commerce.application.catalog import CatalogCommerceService
from cornerroom.modules.commerce.application.service import CheckoutService
from cornerroom.modules.finance.application.accrual import FinanceRoyaltyAccrual
from cornerroom.modules.finance.application.operations import FinanceOpsService
from cornerroom.modules.finance.application.payout import PayoutService
from cornerroom.modules.finance.application.recognition import RecognitionService
from cornerroom.modules.finance.application.recognized_adapter import FinanceRecognizedRevenue
from cornerroom.modules.finance.application.service import PaymentService
from cornerroom.modules.subscriptions.application.service import SubscriptionService
from cornerroom.modules.events.application.service import EventService
from cornerroom.modules.identity.application.organization_service import OrganizationService
from cornerroom.modules.notifications.application.service import NotificationService
from cornerroom.modules.music.application.service import MusicService
from cornerroom.modules.streaming.application.service import StreamingService
from cornerroom.modules.royalties.application.service import RoyaltyService
from cornerroom.modules.search.application.service import SearchService
from cornerroom.modules.ticketing.application.service import TicketingService
from cornerroom.modules.identity.application.services import IdentityService
from cornerroom.modules.identity.domain.models import Session, User

bearer = HTTPBearer(auto_error=False)


async def db_session(session: AsyncSession = Depends(get_session)) -> AsyncSession:
    return session


def settings_dep() -> Settings:
    return get_settings()


async def identity_service(
    session: AsyncSession = Depends(db_session),
    settings: Settings = Depends(settings_dep),
) -> IdentityService:
    return IdentityService(session, settings)


async def authz_service(session: AsyncSession = Depends(db_session)) -> AuthorizationService:
    return AuthorizationService(session)


def _client_meta(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    return ip, ua


async def organization_service(
    session: AsyncSession = Depends(db_session),
    settings: Settings = Depends(settings_dep),
) -> OrganizationService:
    return OrganizationService(session, settings)


async def event_service(session: AsyncSession = Depends(db_session)) -> EventService:
    return EventService(session)


async def campaign_service(session: AsyncSession = Depends(db_session)) -> CampaignService:
    return CampaignService(session, notifications=NullNotificationPort())


async def artist_service(session: AsyncSession = Depends(db_session)) -> ArtistService:
    return ArtistService(session)


async def music_service(session: AsyncSession = Depends(db_session)) -> MusicService:
    return MusicService(session)


async def streaming_service(
    session: AsyncSession = Depends(db_session),
    settings: Settings = Depends(settings_dep),
) -> StreamingService:
    return StreamingService(session, settings=settings)


async def royalty_service(session: AsyncSession = Depends(db_session)) -> RoyaltyService:
    return RoyaltyService(
        session,
        recognized=FinanceRecognizedRevenue(session),
        accrual=FinanceRoyaltyAccrual(session),
    )


async def finance_ops_service(session: AsyncSession = Depends(db_session)) -> FinanceOpsService:
    return FinanceOpsService(session)


async def payout_service(session: AsyncSession = Depends(db_session)) -> PayoutService:
    return PayoutService(session)


async def recognition_service(session: AsyncSession = Depends(db_session)) -> RecognitionService:
    return RecognitionService(session)


async def ticketing_service(
    session: AsyncSession = Depends(db_session),
    settings: Settings = Depends(settings_dep),
) -> TicketingService:
    return TicketingService(session, settings)


async def checkout_service(
    session: AsyncSession = Depends(db_session),
    settings: Settings = Depends(settings_dep),
) -> CheckoutService:
    return CheckoutService(session, settings)


async def catalog_commerce_service(session: AsyncSession = Depends(db_session)) -> CatalogCommerceService:
    return CatalogCommerceService(session)


async def subscription_service(session: AsyncSession = Depends(db_session)) -> SubscriptionService:
    return SubscriptionService(session)


async def payment_service(
    session: AsyncSession = Depends(db_session),
    settings: Settings = Depends(settings_dep),
) -> PaymentService:
    return PaymentService(session, settings)


async def notification_service(session: AsyncSession = Depends(db_session)) -> NotificationService:
    return NotificationService(session)


async def search_service(
    session: AsyncSession = Depends(db_session),
    settings: Settings = Depends(settings_dep),
) -> SearchService:
    return SearchService(session, settings=settings)


async def analytics_service(session: AsyncSession = Depends(db_session)) -> AnalyticsService:
    return AnalyticsService(session)


async def get_optional_auth_context(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(db_session),
    settings: Settings = Depends(settings_dep),
    authz: AuthorizationService = Depends(authz_service),
) -> AuthContext | None:
    if credentials is None:
        return None
    await get_current_user(request, credentials, session, settings, authz)
    ctx = getattr(request.state, "auth", None)
    if ctx is None:
        raise UnauthorizedError()
    return ctx


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(db_session),
    settings: Settings = Depends(settings_dep),
    authz: AuthorizationService = Depends(authz_service),
) -> User:
    if credentials is None:
        raise UnauthorizedError()
    payload = decode_access_token(credentials.credentials, settings)
    sid = payload.get("sid")
    if not sid:
        raise UnauthorizedError("Invalid or expired access token")
    user = await session.get(User, UUID(payload["sub"]))
    if user is None or user.deleted_at is not None:
        raise UnauthorizedError("Account is not active")
    if user.status != "ACTIVE" or user.security_locked_at is not None:
        raise UnauthorizedError("Account is not active")
    session_row = await session.get(Session, UUID(str(sid)))
    now = datetime.now(timezone.utc)
    if (
        session_row is None
        or session_row.user_id != user.id
        or session_row.revoked_at is not None
        or session_row.status == "REVOKED"
        or session_row.expires_at <= now
    ):
        raise UnauthorizedError("Session is not active")
    ip, ua = _client_meta(request)
    org = payload.get("org")
    claimed = UUID(str(org)) if org else None
    candidate = session_row.active_organization_id or claimed
    org_svc = OrganizationService(session, settings)
    resolved_org = await org_svc.resolve_workspace(user.id, candidate)
    perms = await authz.permission_keys(user.id, organization_id=resolved_org)
    request.state.auth = AuthContext(
        user_id=user.id,
        request_id=getattr(request.state, "request_id", ""),
        organization_id=resolved_org,
        permission_keys=perms,
        ip=ip,
        user_agent=ua,
        session_id=session_row.id,
    )
    return user


async def get_auth_context(
    request: Request,
    user: User = Depends(get_current_user),
) -> AuthContext:
    ctx = getattr(request.state, "auth", None)
    if ctx is None:
        raise UnauthorizedError()
    return ctx


def require_permission(
    permission: str,
    resource_type: str | None = None,
    resource_id_param: str | None = None,
) -> Callable:
    async def _inner(
        request: Request,
        user: User = Depends(get_current_user),
        authz: AuthorizationService = Depends(authz_service),
    ) -> User:
        resource_id = None
        if resource_type and resource_id_param:
            raw = request.path_params.get(resource_id_param)
            if raw:
                resource_id = UUID(str(raw))
        await authz.authorize(
            user.id,
            permission,
            resource_type=resource_type,
            resource_id=resource_id,
        )
        return user

    return _inner
