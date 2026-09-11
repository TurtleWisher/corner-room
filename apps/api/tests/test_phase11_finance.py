"""Phase 11 finance & settlement. PostgreSQL tests skip honestly when unavailable."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.modules.royalties.domain.models import Settlement
from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase07_catalog import _workspace


async def _platform_admin(client: AsyncClient) -> tuple[str, str]:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    token = await _workspace(client, admin, platform["id"])
    return token, platform["id"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase11_ledger_payout_dual_control_idor_idempotency(client: AsyncClient) -> None:
    staff, org_id = await _platform_admin(client)
    other = await register_and_login(client, "finance-approver-p11@example.com")
    stranger = await register_and_login(client, "stranger-p11@example.com")

    roles = (await client.get("/api/v1/roles", headers=bearer(staff))).json()
    finance_role = next(row for row in roles if row["key"] == "finance_manager")
    assigned = await client.post(
        f"/api/v1/users/{other['user']['id']}/assignments",
        headers=bearer(staff),
        json={"role_id": finance_role["id"], "organization_id": org_id},
    )
    assert assigned.status_code == 201, assigned.text
    other_token = await _workspace(client, other["access_token"], org_id)

    hidden = await client.get("/api/v1/ledger", headers=bearer(stranger["access_token"]))
    assert hidden.status_code in {403, 404, 409}

    accounts = await client.get("/api/v1/ledger/accounts", headers=bearer(staff))
    assert accounts.status_code == 200, accounts.text
    codes = {row["code"] for row in accounts.json()}
    assert "1000" in codes
    assert all(row["provisional"] is True for row in accounts.json())

    cfg_min = await client.post(
        "/api/v1/finance-config",
        headers=bearer(staff),
        json={"key": "payout_minimum_threshold_minor", "int_value": 0},
    )
    assert cfg_min.status_code == 200, cfg_min.text
    cfg_second = await client.post(
        "/api/v1/finance-config",
        headers=bearer(staff),
        json={"key": "payout_second_approver_threshold_minor", "int_value": 50_000},
    )
    assert cfg_second.status_code == 200, cfg_second.text
    cfg_sched = await client.post(
        "/api/v1/finance-config",
        headers=bearer(staff),
        json={"key": "payout_schedule", "text_value": "MONTHLY"},
    )
    assert cfg_sched.status_code == 200, cfg_sched.text

    payee_id = uuid4()
    compliance = await client.post(
        "/api/v1/payee-compliance",
        headers=bearer(staff),
        json={
            "payee_type": "ARTIST",
            "payee_id": str(payee_id),
            "kyc_present": True,
            "tax_record_present": True,
        },
    )
    assert compliance.status_code == 200, compliance.text
    method = await client.post(
        "/api/v1/payout-methods",
        headers=bearer(staff),
        json={"payee_type": "ARTIST", "payee_id": str(payee_id), "token_ref": "SANDBOX-TOKEN"},
    )
    assert method.status_code == 201, method.text

    category = await client.post(
        "/api/v1/expense-categories",
        headers=bearer(staff),
        json={"code": "VENUE", "name": "Venue rental"},
    )
    assert category.status_code == 201, category.text
    source_id = uuid4()
    expense = await client.post(
        "/api/v1/expenses",
        headers=bearer(staff),
        json={
            "category": "VENUE",
            "amount_minor": 2500,
            "currency_code": "BDT",
            "source_type": "MANUAL",
            "source_id": str(source_id),
        },
    )
    assert expense.status_code == 201, expense.text
    approved = await client.post(
        f"/api/v1/expenses/{expense.json()['id']}/approve",
        headers=bearer(staff),
    )
    assert approved.status_code == 200, approved.text
    recognized = await client.post(
        f"/api/v1/expenses/{expense.json()['id']}/recognize",
        headers=bearer(staff),
    )
    assert recognized.status_code == 200, recognized.text
    assert recognized.json()["status"] == "RECOGNIZED"

    ledger = await client.get("/api/v1/ledger", headers=bearer(staff))
    assert ledger.status_code == 200, ledger.text
    assert any(row["type"] == "EXPENSE" and row["status"] == "POSTED" for row in ledger.json()["items"])

    adj_key = "adj-p11-1"
    adj = await client.post(
        "/api/v1/adjustments",
        headers={**bearer(staff), "Idempotency-Key": adj_key},
        json={
            "reason_code": "ROUNDING",
            "amount_minor": 1,
            "currency_code": "BDT",
            "target_type": "EXPENSE",
            "target_id": expense.json()["id"],
            "debit_account_code": "5900",
            "credit_account_code": "2000",
        },
    )
    assert adj.status_code == 201, adj.text
    adj_again = await client.post(
        "/api/v1/adjustments",
        headers={**bearer(staff), "Idempotency-Key": adj_key},
        json={
            "reason_code": "ROUNDING",
            "amount_minor": 1,
            "currency_code": "BDT",
            "target_type": "EXPENSE",
            "target_id": expense.json()["id"],
            "debit_account_code": "5900",
            "credit_account_code": "2000",
        },
    )
    assert adj_again.status_code == 201
    assert adj_again.json()["id"] == adj.json()["id"]

    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        settlement = Settlement(
            kind="ROYALTY",
            payee_type="ARTIST",
            payee_id=payee_id,
            status="APPROVED",
            amount_minor=1200,
            currency_code="BDT",
        )
        session.add(settlement)
        await session.commit()
        settlement_id = str(settlement.id)

    blocked_self = await client.post(
        "/api/v1/payouts",
        headers={**bearer(staff), "Idempotency-Key": "payout-p11-1"},
        json={"settlement_id": settlement_id, "payout_method_id": method.json()["id"]},
    )
    assert blocked_self.status_code == 201, blocked_self.text
    payout_id = blocked_self.json()["id"]
    self_approve = await client.post(
        f"/api/v1/payouts/{payout_id}/approve",
        headers=bearer(staff),
    )
    assert self_approve.status_code == 409, self_approve.text

    first = await client.post(
        f"/api/v1/payouts/{payout_id}/approve",
        headers=bearer(other_token),
    )
    assert first.status_code == 200, first.text
    paid = await client.post(
        f"/api/v1/payouts/{payout_id}/sandbox-complete",
        headers=bearer(staff),
    )
    assert paid.status_code == 200, paid.text
    assert paid.json()["status"] == "PAID"
    assert paid.json()["provider"] == "SANDBOX"

    replay = await client.post(
        "/api/v1/payouts",
        headers={**bearer(staff), "Idempotency-Key": "payout-p11-1"},
        json={"settlement_id": settlement_id, "payout_method_id": method.json()["id"]},
    )
    assert replay.status_code == 201
    assert replay.json()["id"] == payout_id

    mismatch_list = await client.get("/api/v1/reconciliations", headers=bearer(staff))
    assert mismatch_list.status_code == 200
    idor = await client.get("/api/v1/ledger", headers=bearer(stranger["access_token"]))
    assert idor.status_code in {403, 404, 409}
