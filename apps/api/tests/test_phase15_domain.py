"""Phase 15 Gate 3 — domain remediations. Unit tests do not need PostgreSQL."""

from __future__ import annotations

from uuid import uuid4

import pytest

from cornerroom.infra.errors import AppError, NotFoundError
from cornerroom.infra.settings import Settings
from cornerroom.kernel.auth_context import AuthContext
from cornerroom.modules.authorization.application.service import AuthorizationService
from cornerroom.modules.authorization.domain.models import (
    FOUNDATION_PERMISSIONS,
    GRANT_PRINCIPAL_TYPES,
    RESOURCE_TYPES,
    Permission,
)
from cornerroom.modules.finance.application.sandbox import (
    SandboxPaymentProvider,
    resolve_webhook_secret,
    sign_sandbox_payload,
)
from cornerroom.modules.finance.application.service import PaymentService


JWT = "test-secret-not-for-production-use-please"
PAY = "test-sandbox-payment-secret-distinct-from-jwt"


def test_webhook_secret_fails_closed_when_unset() -> None:
    with pytest.raises(AppError) as exc:
        resolve_webhook_secret(payment_secret=None, jwt_secret=JWT)
    assert exc.value.code == "PAYMENT_WEBHOOK_SECRET_REQUIRED"
    assert exc.value.status == 503


def test_webhook_secret_rejects_jwt_reuse() -> None:
    with pytest.raises(AppError) as exc:
        resolve_webhook_secret(payment_secret=JWT, jwt_secret=JWT)
    assert exc.value.code == "PAYMENT_WEBHOOK_SECRET_REUSED"
    assert exc.value.status == 503


def test_webhook_secret_accepts_dedicated_key() -> None:
    assert resolve_webhook_secret(payment_secret=PAY, jwt_secret=JWT) == PAY


def test_payment_service_webhook_secret_uses_resolver() -> None:
    settings = Settings(app_env="test", jwt_secret=JWT, sandbox_payment_secret=PAY)
    svc = PaymentService(session=None, settings=settings)  # type: ignore[arg-type]
    assert svc.webhook_secret() == PAY
    blank = Settings(app_env="test", jwt_secret=JWT, sandbox_payment_secret=None)
    with pytest.raises(AppError) as exc:
        PaymentService(session=None, settings=blank).webhook_secret()  # type: ignore[arg-type]
    assert exc.value.code == "PAYMENT_WEBHOOK_SECRET_REQUIRED"


def test_sandbox_hmac_does_not_invent_timestamp_window() -> None:
    payload = {
        "payment_id": str(uuid4()),
        "amount_minor": 100,
        "currency_code": "BDT",
        "provider_event_id": "evt-1",
        "status": "CAPTURED",
    }
    signature = sign_sandbox_payload(payload, PAY)
    callback = SandboxPaymentProvider().parse_callback(payload, signature=signature, secret=PAY)
    assert callback.captured is True
    assert "timestamp" not in payload


def test_grant_shape_follows_architecture() -> None:
    assert GRANT_PRINCIPAL_TYPES == ("user", "role", "org_membership")
    assert "artist" in RESOURCE_TYPES
    assert "document" in RESOURCE_TYPES
    assert "ledger" not in RESOURCE_TYPES
    assert "*" not in FOUNDATION_PERMISSIONS


def test_super_admin_seed_not_silently_stripped() -> None:
    from cornerroom.infra.seed import ROLE_PERMISSIONS

    assert ROLE_PERMISSIONS["super_admin"][1] == FOUNDATION_PERMISSIONS
    assert "finance.payout_approve" in ROLE_PERMISSIONS["super_admin"][1]
    assert "music.approve" in ROLE_PERMISSIONS["super_admin"][1]
    assert ROLE_PERMISSIONS["admin"][1] == ("user.admin", "org.admin", "audit.read")
    assert "finance.payout_approve" not in ROLE_PERMISSIONS["admin"][1]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_complete_upload_owner_only(pg_session, settings: Settings) -> None:
    from cornerroom.modules.documents.application.service import DocumentService

    owner = uuid4()
    stranger = uuid4()
    svc = DocumentService(pg_session, settings)
    asset, _ = await svc.create_upload_session(
        AuthContext(user_id=owner, request_id="up-1"),
        storage_class="public_media",
        filename="cover.png",
        mime="image/png",
    )
    with pytest.raises(AppError) as denied:
        await svc.complete_upload(
            AuthContext(user_id=stranger, request_id="up-2"),
            asset_id=asset.id,
            data=b"not-yours",
        )
    assert denied.value.status == 404
    assert denied.value.code == "NOT_FOUND"
    with pytest.raises(AppError) as missing:
        await svc.complete_upload(
            AuthContext(user_id=owner, request_id="up-3"),
            asset_id=uuid4(),
            data=b"gone",
        )
    assert missing.value.status == 404
    done = await svc.complete_upload(
        AuthContext(user_id=owner, request_id="up-4"),
        asset_id=asset.id,
        data=b"ok-bytes",
    )
    assert done.status == "READY"
    assert done.scan_status == "SKIPPED_LOCAL"
    assert done.sha256


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_inspect_user_hides_other_org_memberships(pg_session, settings: Settings) -> None:
    from cornerroom.modules.identity.application.services import IdentityService
    from cornerroom.modules.identity.domain.models import Organization, OrganizationMembership, User

    user = User(email="inspect-g3@example.com", status="ACTIVE")
    org_a = Organization(type="LABEL", name="Gate3 A", status="ACTIVE")
    org_b = Organization(type="LABEL", name="Gate3 B", status="ACTIVE")
    pg_session.add_all([user, org_a, org_b])
    await pg_session.flush()
    pg_session.add_all(
        [
            OrganizationMembership(
                user_id=user.id, organization_id=org_a.id, status="ACTIVE"
            ),
            OrganizationMembership(
                user_id=user.id, organization_id=org_b.id, status="ACTIVE"
            ),
        ]
    )
    await pg_session.flush()
    svc = IdentityService(pg_session, settings)
    _row, _assignments, scoped = await svc.inspect_user(user.id, organization_id=org_a.id)
    orgs = {item["organization_id"] for item in scoped}
    assert org_a.id in orgs
    assert org_b.id not in orgs
    _row, _assignments, unscoped = await svc.inspect_user(user.id, organization_id=None)
    all_orgs = {item["organization_id"] for item in unscoped}
    assert org_a.id in all_orgs and org_b.id in all_orgs


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_audit_list_filters_workspace_org(pg_session) -> None:
    from cornerroom.modules.audit.application.service import AuditService

    svc = AuditService(pg_session)
    org_a = uuid4()
    org_b = uuid4()
    await svc.record(
        action="test.a",
        entity_type="Thing",
        entity_id=uuid4(),
        actor_id="tester",
        organization_id=org_a,
    )
    await svc.record(
        action="test.b",
        entity_type="Thing",
        entity_id=uuid4(),
        actor_id="tester",
        organization_id=org_b,
    )
    scoped, _ = await svc.list_entries(organization_id=org_a)
    assert {row.action for row in scoped} == {"test.a"}
    unscoped, _ = await svc.list_entries()
    assert {row.action for row in unscoped} >= {"test.a", "test.b"}


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_grant_resource_rejects_unknown_type_and_permission(pg_session) -> None:
    from cornerroom.modules.identity.domain.models import User

    actor = User(email="granter-g3@example.com", status="ACTIVE")
    pg_session.add(actor)
    await pg_session.flush()
    pg_session.add(Permission(key="artist.manage", description="artist.manage"))
    await pg_session.flush()
    authz = AuthorizationService(pg_session)
    ctx = AuthContext(user_id=actor.id, request_id="g3-grant")
    with pytest.raises(AppError) as bad_type:
        await authz.grant_resource(
            principal_type="user",
            principal_id=actor.id,
            permission_key="artist.manage",
            resource_type="wallet",
            resource_id=uuid4(),
            ctx=ctx,
        )
    assert bad_type.value.status == 422
    with pytest.raises(AppError) as bad_principal:
        await authz.grant_resource(
            principal_type="impersonation",
            principal_id=actor.id,
            permission_key="artist.manage",
            resource_type="artist",
            resource_id=uuid4(),
            ctx=ctx,
        )
    assert bad_principal.value.status == 422
    with pytest.raises(NotFoundError):
        await authz.grant_resource(
            principal_type="user",
            principal_id=actor.id,
            permission_key="finance.invented",
            resource_type="artist",
            resource_id=uuid4(),
            ctx=ctx,
        )
    grant = await authz.grant_resource(
        principal_type="user",
        principal_id=actor.id,
        permission_key="artist.manage",
        resource_type="artist",
        resource_id=uuid4(),
        ctx=ctx,
    )
    assert grant.status == "ACTIVE"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_refund_requires_workspace_and_scoped_finance_post(
    pg_session, settings: Settings
) -> None:
    from cornerroom.modules.finance.domain.models import Payment
    from cornerroom.modules.identity.domain.models import User

    owner = User(email="pay-owner-g3@example.com", status="ACTIVE")
    staff = User(email="pay-staff-g3@example.com", status="ACTIVE")
    pg_session.add_all([owner, staff])
    await pg_session.flush()
    payment = Payment(
        user_id=owner.id,
        status="CAPTURED",
        amount_minor=100,
        currency_code="BDT",
        provider="sandbox",
        idempotency_key="g3-refund-1",
    )
    pg_session.add(payment)
    await pg_session.flush()
    svc = PaymentService(pg_session, settings=settings)
    with pytest.raises(AppError) as no_ws:
        await svc.request_refund(
            AuthContext(user_id=staff.id, request_id="rf-1"),
            payment_id=payment.id,
            amount_minor=10,
            reason_code="TEST",
            idempotency_key="g3-rf-a",
        )
    assert no_ws.value.code == "WORKSPACE_REQUIRED"
    with pytest.raises(NotFoundError):
        await svc.request_refund(
            AuthContext(
                user_id=staff.id,
                request_id="rf-2",
                organization_id=uuid4(),
            ),
            payment_id=payment.id,
            amount_minor=10,
            reason_code="TEST",
            idempotency_key="g3-rf-b",
        )
