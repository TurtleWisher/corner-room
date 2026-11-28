"""Staff portal (owner, 2026-11-28): staff accounts by email (D-STAFF-ACCOUNTS-01), staff activity,
the one-page overview and artists' royalty rates (D-ROYALTY-RATE-01)."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from httpx import AsyncClient

from tests.auth_helpers import admin_token, bearer, register_and_login, user_by_email
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _buy, _released


async def _verify(email: str) -> None:
    """Mark an address verified, as the verification link or Continue with Google would."""
    from sqlalchemy import select

    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.identity.domain.models import User

    async with get_session_factory()() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one()
        user.email_verified_at = datetime.now(UTC)
        user.status = "ACTIVE"
        await session.commit()


async def _verified(client: AsyncClient, email: str) -> dict:
    person = await register_and_login(client, email)
    await _verify(email)
    return person


async def _accounts(client: AsyncClient, token: str) -> dict:
    res = await client.get("/api/v1/staff/accounts", headers=bearer(token))
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_existing_fan_account_becomes_staff_at_once(client: AsyncClient) -> None:
    owner = await admin_token(client)
    fan = await _verified(client, "sp-fan@example.com")
    added = await client.post(
        "/api/v1/staff/accounts",
        headers=bearer(owner),
        json={"email": "SP-Fan@Example.com ", "level": "STAFF", "areas": ["analyst", "event_manager", "nope"]},
    )
    assert added.status_code == 201, added.text
    assert added.json()["state"] == "ADDED"
    body = await _accounts(client, owner)
    row = next(a for a in body["accounts"] if a["user_id"] == fan["user"]["id"])
    assert row["level"] == "STAFF" and row["areas"] == ["event_manager", "analyst"]
    assert body["can_add_levels"] == ["ADMIN", "STAFF"]
    assert any(a["level"] == "OWNER" and a["is_you"] for a in body["accounts"])
    # The same account, now with staff powers: analytics yes, the accounts page no.
    assert (await client.get("/api/v1/staff/accounts", headers=bearer(fan["access_token"]))).status_code == 403
    overview = await client.get("/api/v1/staff/overview", headers=bearer(fan["access_token"]))
    assert overview.status_code == 200, overview.text
    assert "live" in overview.json() and "staff" not in overview.json()
    assert "money" not in overview.json().get("sales", {})

    # Staff areas need at least one area; a bad email is refused.
    assert (await client.post("/api/v1/staff/accounts", headers=bearer(owner), json={"email": "x@example.com", "level": "STAFF", "areas": []})).status_code == 422
    assert (await client.post("/api/v1/staff/accounts", headers=bearer(owner), json={"email": "not-an-email", "level": "STAFF", "areas": ["analyst"]})).status_code == 422

    # Taking them off works at once.
    gone = await client.delete(f"/api/v1/staff/accounts/{fan['user']['id']}", headers=bearer(owner))
    assert gone.status_code == 204, gone.text
    assert all(a["user_id"] != fan["user"]["id"] for a in (await _accounts(client, owner))["accounts"])
    overview = (await client.get("/api/v1/staff/overview", headers=bearer(fan["access_token"]))).json()
    assert "live" not in overview


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_invite_waits_for_a_verified_account_and_only_the_owner_makes_admins(client: AsyncClient) -> None:
    owner = await admin_token(client)
    waiting = await client.post(
        "/api/v1/staff/accounts", headers=bearer(owner), json={"email": "sp-admin@example.com", "level": "ADMIN", "note": "Ops lead"}
    )
    assert waiting.status_code == 201, waiting.text
    assert waiting.json()["state"] == "WAITING"
    invites = (await _accounts(client, owner))["invites"]
    assert [(i["email"], i["level"], i["note"]) for i in invites if i["email"] == "sp-admin@example.com"] == [
        ("sp-admin@example.com", "ADMIN", "Ops lead")
    ]

    # Signed up but not verified: nothing yet (someone else could have typed that address).
    person = await register_and_login(client, "sp-admin@example.com")
    claim = await client.post("/api/v1/me/staff-invite/claim", headers=bearer(person["access_token"]))
    assert claim.status_code == 200 and claim.json() == {"claimed": False}
    await _verify("sp-admin@example.com")
    claim = await client.post("/api/v1/me/staff-invite/claim", headers=bearer(person["access_token"]))
    assert claim.json() == {"claimed": True}
    assert (await client.post("/api/v1/me/staff-invite/claim", headers=bearer(person["access_token"]))).json() == {"claimed": False}

    admin = person["access_token"]
    body = await _accounts(client, admin)
    assert body["can_add_levels"] == ["STAFF"]
    me = next(a for a in body["accounts"] if a["is_you"])
    assert me["level"] == "ADMIN" and me["can_change"] is False
    assert all(i["email"] != "sp-admin@example.com" for i in body["invites"])

    # An admin adds staff, but never admins, and never changes themselves or the owner.
    refused = await client.post("/api/v1/staff/accounts", headers=bearer(admin), json={"email": "sp-x@example.com", "level": "ADMIN"})
    assert refused.status_code == 403 and refused.json()["code"] == "OWNER_ONLY"
    helper = await _verified(client, "sp-helper@example.com")
    ok = await client.post("/api/v1/staff/accounts", headers=bearer(admin), json={"email": "sp-helper@example.com", "level": "STAFF", "areas": ["content_manager"]})
    assert ok.status_code == 201 and ok.json()["state"] == "ADDED"
    promote = await client.put(f"/api/v1/staff/accounts/{helper['user']['id']}", headers=bearer(admin), json={"level": "ADMIN"})
    assert promote.status_code == 403 and promote.json()["code"] == "OWNER_ONLY"
    myself = await client.delete(f"/api/v1/staff/accounts/{me['user_id']}", headers=bearer(admin))
    assert myself.status_code == 403 and myself.json()["code"] == "NOT_YOURSELF"
    owner_id = (await user_by_email("admin@example.com"))["id"]
    assert (await client.delete(f"/api/v1/staff/accounts/{owner_id}", headers=bearer(admin))).json()["code"] == "OWNER_FIXED"
    changed = await client.put(f"/api/v1/staff/accounts/{helper['user']['id']}", headers=bearer(admin), json={"level": "STAFF", "areas": ["analyst"]})
    assert changed.status_code == 200 and changed.json() == {"level": "STAFF", "areas": ["analyst"]}

    # The owner can promote; the old workspace screen can't hand out Admin for an admin either.
    assert (await client.put(f"/api/v1/staff/accounts/{helper['user']['id']}", headers=bearer(owner), json={"level": "ADMIN"})).status_code == 200
    _admin, orgs = await _orgs(client)
    grantable = await client.get(f"/api/v1/organizations/{orgs['LABEL']}/grantable-roles", headers=bearer(admin))
    if grantable.status_code == 200:
        assert all(r["key"] not in {"staff_admin", "super_admin"} for r in grantable.json())

    # Activity: who did what, staff only.
    activity = await client.get("/api/v1/staff/activity", headers=bearer(owner), params={"area": "Accounts"})
    assert activity.status_code == 200, activity.text
    rows = activity.json()["items"]
    assert any(r["action"] == "staff_account.set" and r["actor_id"] == me["user_id"] for r in rows)
    assert all(r["area"] == "Accounts" for r in rows)
    people = (await client.get("/api/v1/staff/activity/people", headers=bearer(owner))).json()["people"]
    assert any(p["user_id"] == me["user_id"] and p["actions_7d"] >= 1 for p in people)
    fan = await register_and_login(client, "sp-plainfan@example.com")
    assert (await client.get("/api/v1/staff/activity", headers=bearer(fan["access_token"]))).status_code == 403


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_artist_rate_applies_to_every_sale_at_the_rate_of_its_moment(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track, owner, artist_id = await _released(client, admin, label, "rr-owner@example.com", "Rate Act")
    ops = await _staff_with(client, admin, "rr-ops@example.com", "finance_manager", label)
    queue = (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json()
    pid = next(p["id"] for p in queue if p["release_id"] == release_id)
    assert (await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(ops), json={"decision": "accept"})).status_code == 200
    offer_id = next(o["id"] for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)

    fan = await register_and_login(client, "rr-fan1@example.com")
    await _buy(client, fan["access_token"], offer_id)  # ৳30 before any rate

    url = f"/api/v1/staff/royalty-rates/{artist_id}"
    first = (await client.get(url, headers=bearer(admin))).json()
    assert first["share_bps"] is None
    assert first["earlier_without_rate"]["sales"] == 1
    assert first["totals"]["by_currency"][0]["earned_minor"] == 0

    # 70 %, only from now on: the first sale stays "No rate yet".
    set70 = await client.put(url, headers=bearer(admin), json={"share_bps": 7000, "note": "Agreed by phone"})
    assert set70.status_code == 200, set70.text
    assert set70.json()["share_bps"] == 7000 and set70.json()["earlier_without_rate"]["sales"] == 1
    assert (await client.put(url, headers=bearer(admin), json={"share_bps": 7000})).json()["code"] == "SAME_RATE"

    fan2 = await register_and_login(client, "rr-fan2@example.com")
    await _buy(client, fan2["access_token"], offer_id)
    now = (await client.get(url, headers=bearer(admin))).json()
    bdt = now["totals"]["by_currency"][0]
    assert bdt["sales"] == 2 and bdt["earned_minor"] == 2100 and bdt["no_rate_sales"] == 1

    # 50 % from now, also covering the earlier sale: the second sale keeps its 70 %.
    set50 = await client.put(url, headers=bearer(admin), json={"share_bps": 5000, "cover_earlier": True})
    assert set50.status_code == 200, set50.text
    bdt = set50.json()["totals"]["by_currency"][0]
    assert bdt["earned_minor"] == 1500 + 2100 and bdt["no_rate_sales"] == 0
    assert sorted(s["share_bps"] for s in set50.json()["sales"]) == [5000, 7000]
    assert [h["share_bps"] for h in set50.json()["history"]][:1] == [5000]

    # Lists, the act's own view, and who may do what.
    listed = (await client.get("/api/v1/staff/royalty-rates", headers=bearer(admin), params={"q": "Rate Act"})).json()
    assert [i["share_bps"] for i in listed["items"] if i["artist_id"] == artist_id] == [5000]
    mine = (await client.get("/api/v1/me/royalty-rates", headers=bearer(owner["access_token"]))).json()["acts"]
    assert mine[0]["share_bps"] == 5000 and mine[0]["by_currency"][0]["earned_minor"] == 3600
    assert (await client.put(url, headers=bearer(fan["access_token"]), json={"share_bps": 9000})).status_code == 403
    assert (await client.get(url, headers=bearer(owner["access_token"]))).status_code == 403
    assert (await client.put(url, headers=bearer(admin), json={"share_bps": 10001})).status_code == 422

    ended = await client.post(f"{url}/end", headers=bearer(admin), json={"note": "Contract over"})
    assert ended.status_code == 200 and ended.json()["share_bps"] is None
    assert ended.json()["totals"]["by_currency"][0]["earned_minor"] == 3600
    audit = (await client.get("/api/v1/staff/activity", headers=bearer(admin), params={"area": "Money"})).json()["items"]
    assert {"royalty_rate.set", "royalty_rate.ended"} <= {r["action"] for r in audit if r["entity_id"] == artist_id}
    assert UUID(artist_id)
