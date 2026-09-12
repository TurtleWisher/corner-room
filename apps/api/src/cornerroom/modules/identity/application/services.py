"""Identity application services — auth, users, sessions, lifecycle."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.errors import AppError, ConflictError, NotFoundError, UnauthorizedError
from cornerroom.infra.outbox import enqueue_outbox
from cornerroom.infra.security import create_access_token
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.events import (
    ACCOUNT_LOCKED,
    ACCOUNT_UNLOCKED,
    PASSWORD_CHANGED,
    PASSWORD_RESET,
    REFRESH_TOKEN_REPLAY_DETECTED,
    REFRESH_TOKEN_ROTATED,
    SESSION_CREATED,
    SESSION_REVOKED,
    USER_ACTIVATED,
    USER_CLOSED,
    USER_LOGGED_IN,
    USER_LOGGED_OUT,
    USER_REGISTERED,
    USER_SUSPENDED,
    USER_VERIFIED,
    DomainEvent,
)
from cornerroom.kernel.ids import new_uuid
from cornerroom.kernel.outbox import event_bus
from cornerroom.modules.audit.application.service import AuditService
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.identity.application.credentials import (
    hash_secret,
    hash_user_password,
    new_opaque_token,
    password_matches,
)
from cornerroom.modules.identity.application.lifecycle import target_for_action, transition_action
from cornerroom.modules.identity.application.rate_limit import enforce_auth_rate_limit
from cornerroom.modules.identity.domain.models import (
    CustomerProfile,
    IdentityChallenge,
    Session,
    User,
)


def _normalize_email(email: str) -> str:
    return email.strip().lower()


class IdentityService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        clock: Clock | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.clock = clock or SystemClock()
        self.audit = AuditService(session)
        self.authz = AuthorizationService(session, clock=self.clock)

    async def get_user_row(self, user_id: UUID) -> User:
        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None:
            raise NotFoundError("User not found")
        return user

    async def register(
        self,
        *,
        email: str,
        password: str,
        display_name: str,
        request_id: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[User, CustomerProfile]:
        await enforce_auth_rate_limit(settings=self.settings, scope="register", key=ip or "unknown")
        email_n = _normalize_email(email)
        existing = await self._get_user_by_email(email_n)
        if existing:
            raise ConflictError("An account with this email already exists")
        user = User(
            email=email_n,
            password_hash=hash_user_password(password),
            status="PENDING_VERIFICATION",
        )
        self.session.add(user)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            raise ConflictError("An account with this email already exists") from exc
        profile = CustomerProfile(
            user_id=user.id,
            display_name=display_name.strip() or email_n.split("@")[0],
            status="ACTIVE",
            locale="en",
        )
        self.session.add(profile)
        await self.session.flush()

        customer_role = await self.authz.get_role_by_key("customer")
        ctx = AuthContext(
            user_id=user.id,
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
        )
        if customer_role:
            await self.authz.assign_role(
                user_id=user.id,
                role_id=customer_role.id,
                organization_id=None,
                ctx=ctx,
            )

        event = DomainEvent(
            event_type=USER_REGISTERED,
            producer="identity",
            aggregate_type="User",
            aggregate_id=user.id,
            payload={
                "email": email_n,
                "status": user.status,
                "verification_required": True,
            },
            occurred_at=self.clock.now(),
            actor_id=user.id,
            correlation_id=request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record(
            action="user.registered",
            entity_type="User",
            entity_id=user.id,
            actor_id=str(user.id),
            new_state={"status": user.status, "email_verified": False},
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
        )
        return user, profile

    async def login(
        self,
        *,
        email: str,
        password: str,
        request_id: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[User, CustomerProfile | None, str, str, datetime]:
        await enforce_auth_rate_limit(settings=self.settings, scope="login", key=ip or "unknown")
        email_n = _normalize_email(email)
        user = await self._get_user_by_email(email_n)
        invalid = (
            user is None
            or user.deleted_at is not None
            or not password_matches(user.password_hash, password)
        )
        if invalid:
            await self._audit_login_failed(
                entity_id=user.id if user is not None else "unknown",
                actor_id="anonymous",
                actor_type="anonymous",
                reason="invalid_credentials",
                request_id=request_id,
                ip=ip,
                user_agent=user_agent,
            )
            raise UnauthorizedError("Invalid email or password")
        if user.security_locked_at is not None:
            await self._audit_login_failed(
                entity_id=user.id,
                actor_id=str(user.id),
                reason="locked",
                request_id=request_id,
                ip=ip,
                user_agent=user_agent,
                extra={"status": user.status},
            )
            raise AppError("ACCOUNT_LOCKED", "Account is not available", 403)
        if user.status != "ACTIVE":
            await self._audit_login_failed(
                entity_id=user.id,
                actor_id=str(user.id),
                reason="status",
                request_id=request_id,
                ip=ip,
                user_agent=user_agent,
                extra={"status": user.status},
            )
            raise AppError("ACCOUNT_NOT_ACTIVE", "Account is not active", 403)
        profile = await self._get_profile(user.id)
        refresh, session_row = await self._issue_refresh(user.id, ip=ip, user_agent=user_agent)
        access, expires = create_access_token(
            user_id=user.id,
            settings=self.settings,
            session_id=session_row.id,
        )
        event = DomainEvent(
            event_type=USER_LOGGED_IN,
            producer="identity",
            aggregate_type="User",
            aggregate_id=user.id,
            payload={"session_id": str(session_row.id)},
            occurred_at=self.clock.now(),
            actor_id=user.id,
            correlation_id=request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record(
            action="auth.login",
            entity_type="User",
            entity_id=user.id,
            actor_id=str(user.id),
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
            new_state={"session_id": str(session_row.id)},
        )
        return user, profile, access, refresh, expires

    async def logout(self, refresh_token: str | None, ctx: AuthContext) -> None:
        session_row = None
        if refresh_token:
            session_row = await self._get_session_by_token(refresh_token)
        if session_row is None and ctx.session_id:
            session_row = await self.session.get(Session, ctx.session_id)
        if session_row and session_row.revoked_at is None:
            await self._revoke_session(session_row, reason="logout")
            await self._emit_session_revoked(session_row, ctx.user_id, ctx.request_id)
        event = DomainEvent(
            event_type=USER_LOGGED_OUT,
            producer="identity",
            aggregate_type="User",
            aggregate_id=ctx.user_id,
            payload={},
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action="auth.logout",
            entity_type="User",
            entity_id=ctx.user_id,
        )

    async def refresh(
        self,
        refresh_token: str,
        request_id: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[User, str, str, datetime]:
        await enforce_auth_rate_limit(settings=self.settings, scope="refresh", key=ip or "unknown")
        token_hash = hash_secret(refresh_token)
        stmt = select(Session).where(Session.refresh_token_hash == token_hash).with_for_update()
        session_row = (await self.session.execute(stmt)).scalar_one_or_none()
        now = self.clock.now()
        if session_row is None:
            raise UnauthorizedError("Refresh token is invalid or expired")
        if session_row.revoked_at is not None or session_row.status == "REVOKED":
            await self._handle_refresh_replay(session_row, request_id=request_id, ip=ip, user_agent=user_agent)
            raise UnauthorizedError("Refresh token is invalid or expired")
        if session_row.expires_at <= now:
            raise UnauthorizedError("Refresh token is invalid or expired")
        user = await self.session.get(User, session_row.user_id)
        if (
            user is None
            or user.status != "ACTIVE"
            or user.deleted_at is not None
            or user.security_locked_at is not None
        ):
            raise UnauthorizedError("Account is not active")
        await self._revoke_session(session_row, reason="rotated")
        new_refresh, new_session = await self._issue_refresh(
            user.id,
            ip=ip,
            user_agent=user_agent,
            rotated_from_id=session_row.id,
            family_id=session_row.family_id,
            active_organization_id=session_row.active_organization_id,
        )
        from cornerroom.modules.identity.application.organization_service import OrganizationService

        org_svc = OrganizationService(self.session, self.settings, clock=self.clock)
        resolved_org = await org_svc.resolve_workspace(user.id, new_session.active_organization_id)
        if new_session.active_organization_id != resolved_org:
            new_session.active_organization_id = resolved_org
            await self.session.flush()
        access, expires = create_access_token(
            user_id=user.id,
            settings=self.settings,
            session_id=new_session.id,
            organization_id=resolved_org,
        )
        event = DomainEvent(
            event_type=REFRESH_TOKEN_ROTATED,
            producer="identity",
            aggregate_type="Session",
            aggregate_id=new_session.id,
            payload={"family_id": str(session_row.family_id)},
            occurred_at=now,
            actor_id=user.id,
            correlation_id=request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record(
            action="auth.refresh",
            entity_type="Session",
            entity_id=session_row.id,
            actor_id=str(user.id),
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
            new_state={"session_id": str(new_session.id)},
        )
        return user, access, new_refresh, expires

    async def get_me(self, user_id: UUID) -> tuple[User, CustomerProfile | None]:
        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None:
            raise NotFoundError("User not found")
        return user, await self._get_profile(user_id)

    async def update_me(
        self,
        ctx: AuthContext,
        *,
        display_name: str | None = None,
        locale: str | None = None,
    ) -> CustomerProfile:
        profile = await self._get_profile(ctx.user_id)
        if profile is None:
            raise NotFoundError("Customer profile not found")
        previous = {"display_name": profile.display_name, "locale": profile.locale}
        if display_name is not None:
            profile.display_name = display_name.strip()
        if locale is not None:
            if locale not in {"en", "bn"}:
                raise AppError("VALIDATION_ERROR", "Invalid locale", 422, "locale must be en or bn")
            profile.locale = locale
        profile.updated_by = ctx.user_id
        await self.session.flush()
        await self.audit.record_from_auth(
            ctx,
            action="customer_profile.updated",
            entity_type="CustomerProfile",
            entity_id=profile.id,
            previous_state=previous,
            new_state={"display_name": profile.display_name, "locale": profile.locale},
        )
        return profile

    async def change_password(
        self,
        ctx: AuthContext,
        *,
        current_password: str,
        new_password: str,
    ) -> tuple[str, str, datetime]:
        user = await self.session.get(User, ctx.user_id)
        if user is None or user.deleted_at is not None:
            raise NotFoundError("User not found")
        if not password_matches(user.password_hash, current_password):
            raise UnauthorizedError("Invalid email or password")
        user.password_hash = hash_user_password(new_password)
        await self._revoke_user_sessions(user.id, reason="password_changed")
        refresh, session_row = await self._issue_refresh(
            user.id,
            ip=ctx.ip,
            user_agent=ctx.user_agent,
        )
        access, expires = create_access_token(
            user_id=user.id,
            settings=self.settings,
            session_id=session_row.id,
        )
        event = DomainEvent(
            event_type=PASSWORD_CHANGED,
            producer="identity",
            aggregate_type="User",
            aggregate_id=user.id,
            payload={},
            occurred_at=self.clock.now(),
            actor_id=user.id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action="auth.password_changed",
            entity_type="User",
            entity_id=user.id,
        )
        return access, refresh, expires

    async def request_password_recovery(
        self,
        *,
        email: str,
        request_id: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> None:
        await enforce_auth_rate_limit(settings=self.settings, scope="recovery", key=ip or "unknown")
        email_n = _normalize_email(email)
        user = await self._get_user_by_email(email_n)
        ttl = self.settings.password_recovery_ttl_seconds
        if user is not None and user.deleted_at is None and ttl > 0:
            await self.issue_challenge(
                user_id=user.id,
                purpose="PASSWORD_RECOVERY",
                ttl_seconds=ttl,
                request_id=request_id,
                ip=ip,
                user_agent=user_agent,
            )
        await self.audit.record(
            action="auth.password_recovery_requested",
            entity_type="User",
            entity_id=str(user.id) if user else "unknown",
            actor_id="anonymous",
            actor_type="anonymous",
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
            new_state={"issued": bool(user is not None and ttl > 0)},
        )

    async def complete_password_recovery(
        self,
        *,
        token: str,
        new_password: str,
        request_id: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> None:
        challenge = await self._consume_challenge(
            token,
            purpose="PASSWORD_RECOVERY",
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
        )
        user = await self.session.get(User, challenge.user_id)
        if user is None or user.deleted_at is not None:
            raise UnauthorizedError("Recovery token is invalid")
        user.password_hash = hash_user_password(new_password)
        await self._revoke_user_sessions(user.id, reason="password_reset")
        event = DomainEvent(
            event_type=PASSWORD_RESET,
            producer="identity",
            aggregate_type="User",
            aggregate_id=user.id,
            payload={},
            occurred_at=self.clock.now(),
            actor_id=user.id,
            correlation_id=request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record(
            action="auth.password_reset",
            entity_type="User",
            entity_id=user.id,
            actor_id=str(user.id),
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
        )

    async def request_verification(
        self,
        *,
        email: str,
        request_id: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> None:
        await enforce_auth_rate_limit(settings=self.settings, scope="verification", key=ip or "unknown")
        email_n = _normalize_email(email)
        user = await self._get_user_by_email(email_n)
        ttl = self.settings.verification_challenge_ttl_seconds
        if (
            user is not None
            and user.deleted_at is None
            and user.status == "PENDING_VERIFICATION"
            and ttl > 0
        ):
            await self.issue_challenge(
                user_id=user.id,
                purpose="EMAIL_VERIFICATION",
                ttl_seconds=ttl,
                request_id=request_id,
                ip=ip,
                user_agent=user_agent,
            )
        await self.audit.record(
            action="auth.verification_requested",
            entity_type="User",
            entity_id=str(user.id) if user else "unknown",
            actor_id="anonymous",
            actor_type="anonymous",
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
            new_state={"issued": bool(user is not None and ttl > 0)},
        )

    async def complete_verification(
        self,
        *,
        token: str,
        request_id: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> User:
        challenge = await self._consume_challenge(
            token,
            purpose="EMAIL_VERIFICATION",
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
        )
        user = await self.session.get(User, challenge.user_id)
        if user is None or user.deleted_at is not None:
            raise UnauthorizedError("Verification token is invalid")
        previous = user.status
        if user.status == "PENDING_VERIFICATION":
            transition_action(user.status, "ACTIVE")
            user.status = "ACTIVE"
        user.email_verified_at = self.clock.now()
        await self.session.flush()
        event = DomainEvent(
            event_type=USER_VERIFIED,
            producer="identity",
            aggregate_type="User",
            aggregate_id=user.id,
            payload={"previous_status": previous, "status": user.status},
            occurred_at=self.clock.now(),
            actor_id=user.id,
            correlation_id=request_id,
        )
        await enqueue_outbox(self.session, event)
        if previous == "PENDING_VERIFICATION":
            await self._emit_status_event(user, USER_ACTIVATED, request_id)
        await self.audit.record(
            action="user.verified",
            entity_type="User",
            entity_id=user.id,
            actor_id=str(user.id),
            previous_state={"status": previous},
            new_state={"status": user.status, "email_verified": True},
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
        )
        return user

    async def issue_challenge(
        self,
        *,
        user_id: UUID,
        purpose: str,
        ttl_seconds: int,
        request_id: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> str:
        if ttl_seconds <= 0:
            raise AppError("POLICY_DISABLED", "Challenge issuance is not configured", 409)
        raw = new_opaque_token()
        now = self.clock.now()
        row = IdentityChallenge(
            user_id=user_id,
            purpose=purpose,
            token_hash=hash_secret(raw),
            status="ISSUED",
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        self.session.add(row)
        await self.session.flush()
        await self.audit.record(
            action="identity.challenge_issued",
            entity_type="IdentityChallenge",
            entity_id=row.id,
            actor_id=str(user_id),
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
            new_state={"purpose": purpose},
        )
        return raw

    async def apply_lifecycle(
        self,
        ctx: AuthContext,
        *,
        user_id: UUID,
        action: str,
    ) -> User:
        user = await self.session.get(User, user_id)
        if user is None or user.deleted_at is not None:
            raise NotFoundError("User not found")
        if action == "lock":
            return await self._set_lock(ctx, user, locked=True)
        if action == "unlock":
            return await self._set_lock(ctx, user, locked=False)
        target = target_for_action(action)
        previous = user.status
        transition_action(previous, target)
        user.status = target
        user.updated_by = ctx.user_id
        if target != "ACTIVE":
            await self._revoke_user_sessions(user.id, reason=f"lifecycle_{action}")
        await self.session.flush()
        event_type = {
            "activate": USER_ACTIVATED,
            "suspend": USER_SUSPENDED,
            "unsuspend": USER_ACTIVATED,
            "close": USER_CLOSED,
        }[action]
        await self._emit_status_event(user, event_type, ctx.request_id, actor_id=ctx.user_id)
        await self.audit.record_from_auth(
            ctx,
            action=f"user.{action}",
            entity_type="User",
            entity_id=user.id,
            previous_state={"status": previous},
            new_state={"status": user.status},
        )
        return user

    async def list_sessions(self, user_id: UUID) -> list[Session]:
        stmt = (
            select(Session)
            .where(Session.user_id == user_id)
            .order_by(Session.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def revoke_session(self, ctx: AuthContext, session_id: UUID) -> Session:
        row = await self.session.get(Session, session_id)
        if row is None or row.user_id != ctx.user_id:
            raise NotFoundError("Session not found")
        if row.revoked_at is None:
            await self._revoke_session(row, reason="targeted")
            await self._emit_session_revoked(row, ctx.user_id, ctx.request_id)
        await self.audit.record_from_auth(
            ctx,
            action="session.revoked",
            entity_type="Session",
            entity_id=row.id,
            new_state={"status": row.status},
        )
        return row

    async def revoke_all_sessions(self, ctx: AuthContext, *, keep_current: bool = False) -> int:
        rows = await self.list_sessions(ctx.user_id)
        count = 0
        for row in rows:
            if keep_current and ctx.session_id and row.id == ctx.session_id:
                continue
            if row.revoked_at is None:
                await self._revoke_session(row, reason="revoke_all")
                count += 1
        await self.audit.record_from_auth(
            ctx,
            action="session.revoked_all",
            entity_type="User",
            entity_id=ctx.user_id,
            new_state={"count": count},
        )
        return count

    async def _set_lock(self, ctx: AuthContext, user: User, *, locked: bool) -> User:
        previous = {"security_locked": user.security_locked_at is not None, "status": user.status}
        if locked:
            user.security_locked_at = self.clock.now()
            await self._revoke_user_sessions(user.id, reason="locked")
            event_type = ACCOUNT_LOCKED
            action = "user.locked"
        else:
            user.security_locked_at = None
            event_type = ACCOUNT_UNLOCKED
            action = "user.unlocked"
        user.updated_by = ctx.user_id
        await self.session.flush()
        event = DomainEvent(
            event_type=event_type,
            producer="identity",
            aggregate_type="User",
            aggregate_id=user.id,
            payload={"locked": locked},
            occurred_at=self.clock.now(),
            actor_id=ctx.user_id,
            correlation_id=ctx.request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record_from_auth(
            ctx,
            action=action,
            entity_type="User",
            entity_id=user.id,
            previous_state=previous,
            new_state={"security_locked": locked, "status": user.status},
        )
        return user

    async def _emit_status_event(
        self,
        user: User,
        event_type: str,
        request_id: str,
        actor_id: UUID | None = None,
    ) -> None:
        event = DomainEvent(
            event_type=event_type,
            producer="identity",
            aggregate_type="User",
            aggregate_id=user.id,
            payload={"status": user.status},
            occurred_at=self.clock.now(),
            actor_id=actor_id or user.id,
            correlation_id=request_id,
        )
        await enqueue_outbox(self.session, event)

    async def _emit_session_revoked(self, session_row: Session, actor_id: UUID, request_id: str) -> None:
        event = DomainEvent(
            event_type=SESSION_REVOKED,
            producer="identity",
            aggregate_type="Session",
            aggregate_id=session_row.id,
            payload={"family_id": str(session_row.family_id)},
            occurred_at=self.clock.now(),
            actor_id=actor_id,
            correlation_id=request_id,
        )
        await enqueue_outbox(self.session, event)

    async def _handle_refresh_replay(
        self,
        session_row: Session,
        *,
        request_id: str,
        ip: str | None,
        user_agent: str | None,
    ) -> None:
        successor = (
            await self.session.execute(
                select(Session).where(Session.rotated_from_id == session_row.id)
            )
        ).scalar_one_or_none()
        if successor is None:
            return
        await self._revoke_family(session_row.family_id, reason="replay")
        event = DomainEvent(
            event_type=REFRESH_TOKEN_REPLAY_DETECTED,
            producer="identity",
            aggregate_type="Session",
            aggregate_id=session_row.id,
            payload={"family_id": str(session_row.family_id)},
            occurred_at=self.clock.now(),
            actor_id=session_row.user_id,
            correlation_id=request_id,
        )
        await enqueue_outbox(self.session, event)
        await self.audit.record(
            action="auth.refresh_replay",
            entity_type="Session",
            entity_id=session_row.id,
            actor_id=str(session_row.user_id),
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
            new_state={"family_revoked": True},
        )

    async def _revoke_family(self, family_id: UUID, *, reason: str) -> None:
        now = self.clock.now()
        rows = (
            await self.session.execute(select(Session).where(Session.family_id == family_id))
        ).scalars().all()
        for row in rows:
            if row.revoked_at is None:
                row.revoked_at = now
                row.status = "REVOKED"
                row.last_used_at = now

    async def _revoke_session(self, session_row: Session, *, reason: str) -> None:
        now = self.clock.now()
        session_row.revoked_at = now
        session_row.status = "REVOKED"
        session_row.last_used_at = now

    async def _revoke_user_sessions(self, user_id: UUID, *, reason: str) -> None:
        rows = await self.list_sessions(user_id)
        for row in rows:
            if row.revoked_at is None:
                await self._revoke_session(row, reason=reason)

    async def _consume_challenge(
        self,
        token: str,
        *,
        purpose: str,
        request_id: str,
        ip: str | None,
        user_agent: str | None,
    ) -> IdentityChallenge:
        token_hash = hash_secret(token)
        stmt = select(IdentityChallenge).where(IdentityChallenge.token_hash == token_hash).with_for_update()
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        now = self.clock.now()
        if row is None or row.purpose != purpose:
            await self.audit.record(
                action="identity.challenge_invalid",
                entity_type="IdentityChallenge",
                entity_id="unknown",
                actor_id="anonymous",
                actor_type="anonymous",
                request_id=request_id,
                ip=ip,
                user_agent=user_agent,
                new_state={"purpose": purpose, "reason": "missing"},
            )
            raise UnauthorizedError("Token is invalid")
        if row.status == "CONSUMED":
            await self.audit.record(
                action="identity.challenge_replay",
                entity_type="IdentityChallenge",
                entity_id=row.id,
                actor_id=str(row.user_id),
                request_id=request_id,
                ip=ip,
                user_agent=user_agent,
            )
            raise UnauthorizedError("Token is invalid")
        if row.status != "ISSUED" or row.expires_at <= now:
            if row.status == "ISSUED":
                row.status = "EXPIRED"
            raise UnauthorizedError("Token is invalid")
        row.status = "CONSUMED"
        row.consumed_at = now
        await self.session.flush()
        return row

    async def _audit_login_failed(
        self,
        *,
        entity_id: str | UUID,
        actor_id: str,
        reason: str,
        request_id: str,
        ip: str | None,
        user_agent: str | None,
        actor_type: str = "user",
        extra: dict | None = None,
    ) -> None:
        state = {"reason": reason}
        if extra:
            state.update(extra)
        await self.audit.record(
            action="auth.login_failed",
            entity_type="User",
            entity_id=entity_id,
            actor_id=actor_id,
            actor_type=actor_type,
            new_state=state,
            request_id=request_id,
            ip=ip,
            user_agent=user_agent,
        )
        await self.session.commit()

    async def _get_user_by_email(self, email: str) -> User | None:
        stmt = select(User).where(User.email == email, User.deleted_at.is_(None))
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def _get_profile(self, user_id: UUID) -> CustomerProfile | None:
        stmt = select(CustomerProfile).where(
            CustomerProfile.user_id == user_id,
            CustomerProfile.deleted_at.is_(None),
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def _issue_refresh(
        self,
        user_id: UUID,
        *,
        ip: str | None,
        user_agent: str | None,
        rotated_from_id: UUID | None = None,
        family_id: UUID | None = None,
        active_organization_id: UUID | None = None,
    ) -> tuple[str, Session]:
        raw = new_opaque_token()
        now = self.clock.now()
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        session_row = Session(
            user_id=user_id,
            family_id=family_id or new_uuid(),
            refresh_token_hash=hash_secret(raw),
            expires_at=now + timedelta(seconds=self.settings.jwt_refresh_ttl_seconds),
            last_used_at=now,
            status="ACTIVE",
            user_agent=user_agent,
            ip=ip,
            rotated_from_id=rotated_from_id,
            active_organization_id=active_organization_id,
        )
        self.session.add(session_row)
        await self.session.flush()
        event = DomainEvent(
            event_type=SESSION_CREATED,
            producer="identity",
            aggregate_type="Session",
            aggregate_id=session_row.id,
            payload={"family_id": str(session_row.family_id)},
            occurred_at=now,
            actor_id=user_id,
        )
        await enqueue_outbox(self.session, event)
        return raw, session_row

    async def _get_session_by_token(self, token: str) -> Session | None:
        stmt = select(Session).where(Session.refresh_token_hash == hash_secret(token))
        return (await self.session.execute(stmt)).scalar_one_or_none()


async def publish_after_commit(events: list[DomainEvent]) -> None:
    for event in events:
        await event_bus.publish(event)
