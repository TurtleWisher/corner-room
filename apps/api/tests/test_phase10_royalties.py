"""Phase 10 royalty engine. PostgreSQL tests skip honestly when unavailable."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from cornerroom.infra.db import get_engine
from cornerroom.modules.streaming.domain.models import PlaybackEvent
from tests.auth_helpers import admin_token, bearer, register_and_login
from tests.test_phase07_catalog import _ready_version, _release_track, _workspace


async def _platform_admin(client: AsyncClient) -> tuple[str, str]:
    admin = await admin_token(client)
    orgs = (await client.get("/api/v1/organizations", headers=bearer(admin))).json()["items"]
    platform = next(row for row in orgs if row["type"] == "PLATFORM")
    token = await _workspace(client, admin, platform["id"])
    return token, platform["id"]


async def _released_track(client: AsyncClient, token: str, title: str) -> dict:
    created = await client.post("/api/v1/tracks", headers=bearer(token), json={"title": title})
    assert created.status_code == 201, created.text
    await _ready_version(client, token, created.json()["id"])
    return await _release_track(client, token, created.json()["id"], created.json()["version"])


async def _user_id(client: AsyncClient, token: str) -> str:
    me = await client.get("/api/v1/me", headers=bearer(token))
    assert me.status_code == 200, me.text
    return me.json()["id"]


def _period() -> tuple[str, str]:
    start = datetime.now(timezone.utc) - timedelta(days=1)
    end = datetime.now(timezone.utc) + timedelta(days=1)
    return start.isoformat(), end.isoformat()


async def _active_rule(client: AsyncClient, token: str, key: str, min_ms: int = 1) -> dict:
    created = await client.post(
        "/api/v1/royalty-rules",
        headers=bearer(token),
        json={
            "key": key,
            "definition": {
                "pool_type": "PRO_RATA_BY_ELIGIBLE_PLAY",
                "right_type": "MASTER",
                "share_effective": "PLAY_TIME",
                "eligibility": {"min_duration_ms": min_ms, "exclude_ignored": True},
            },
        },
    )
    assert created.status_code == 201, created.text
    live = await client.post(
        f"/api/v1/royalty-rules/{created.json()['id']}/lifecycle",
        headers=bearer(token),
        json={"action": "activate"},
    )
    assert live.status_code == 200, live.text
    return live.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase10_rights_pool_calc_idor_idempotency(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    artist_user = await register_and_login(client, "payee-p10@example.com")
    other = await register_and_login(client, "other-p10@example.com")
    payee_id = await _user_id(client, artist_user["access_token"])
    track = await _released_track(client, staff, "Royalty Track")
    start, end = _period()

    missing_share = await client.put(
        f"/api/v1/tracks/{track['id']}/rights",
        headers=bearer(staff),
        json={
            "territory": "WW",
            "shares": [
                {
                    "right_type": "MASTER",
                    "payee_type": "USER",
                    "payee_id": payee_id,
                    "share_bps": 5000,
                    "effective_from": start,
                }
            ],
        },
    )
    assert missing_share.status_code == 409
    assert missing_share.json()["code"] == "SHARE_COVERAGE"

    rights = await client.put(
        f"/api/v1/tracks/{track['id']}/rights",
        headers=bearer(staff),
        json={
            "territory": "WW",
            "shares": [
                {
                    "right_type": "MASTER",
                    "payee_type": "USER",
                    "payee_id": payee_id,
                    "share_bps": 10000,
                    "effective_from": start,
                }
            ],
        },
    )
    assert rights.status_code == 200, rights.text
    activated = await client.post(
        f"/api/v1/rights/{rights.json()['id']}/lifecycle",
        headers=bearer(staff),
        json={"action": "activate"},
    )
    assert activated.status_code == 200, activated.text
    assert activated.json()["status"] == "ACTIVE"

    stolen_rights = await client.get(
        f"/api/v1/tracks/{track['id']}/rights",
        headers=bearer(other["access_token"]),
    )
    assert stolen_rights.status_code == 404

    rule = await _active_rule(client, staff, "PRO_RATA_BY_ELIGIBLE_PLAY")
    freeze_open = await client.post(
        "/api/v1/revenue-pools",
        headers=bearer(staff),
        json={
            "period_start": start,
            "period_end": end,
            "source_type": "STREAMING_SUB",
            "currency_code": "USD",
            "rule_id": rule["id"],
        },
    )
    assert freeze_open.status_code == 201, freeze_open.text
    blocked_freeze = await client.post(
        f"/api/v1/revenue-pools/{freeze_open.json()['id']}/freeze",
        headers=bearer(staff),
    )
    assert blocked_freeze.status_code == 409
    assert blocked_freeze.json()["code"] == "RECOGNITION_REQUIRED"

    intake = await client.post(
        "/api/v1/recognized-revenue",
        headers={**bearer(staff), "Idempotency-Key": "rev-p10-1"},
        json={
            "source_type": "STREAMING_SUB",
            "period_start": start,
            "period_end": end,
            "amount_minor": 1000,
            "currency_code": "USD",
        },
    )
    assert intake.status_code == 201, intake.text
    replay_intake = await client.post(
        "/api/v1/recognized-revenue",
        headers={**bearer(staff), "Idempotency-Key": "rev-p10-1"},
        json={
            "source_type": "STREAMING_SUB",
            "period_start": start,
            "period_end": end,
            "amount_minor": 999999,
            "currency_code": "USD",
        },
    )
    assert replay_intake.status_code == 201
    assert replay_intake.json()["id"] == intake.json()["id"]
    assert replay_intake.json()["amount_minor"] == 1000

    frozen = await client.post(
        f"/api/v1/revenue-pools/{freeze_open.json()['id']}/freeze",
        headers=bearer(staff),
    )
    assert frozen.status_code == 200, frozen.text
    assert frozen.json()["status"] == "FROZEN"
    assert frozen.json()["amount_minor"] == 1000

    fan = await register_and_login(client, "listener-p10@example.com")
    grant = await client.post(
        "/api/v1/entitlements/grants",
        headers=bearer(staff),
        json={
            "user_id": await _user_id(client, fan["access_token"]),
            "entitlement_type": "ADMIN_GRANT",
            "ref_id": track["id"],
            "scope": "CATALOG",
        },
    )
    assert grant.status_code == 201, grant.text
    session = await client.post(
        "/api/v1/playback/sessions",
        headers=bearer(fan["access_token"]),
        json={"track_id": track["id"]},
    )
    assert session.status_code == 201, session.text
    play = await client.post(
        "/api/v1/playback/events",
        headers={**bearer(fan["access_token"]), "Idempotency-Key": "p10-play-1"},
        json={
            "client_event_id": str(uuid4()),
            "track_id": track["id"],
            "session_id": session.json()["id"],
            "duration_ms": 20000,
            "completed": True,
        },
    )
    assert play.status_code == 201, play.text
    playback_id = play.json()["id"]
    hint_before = play.json()["eligible_hint"]
    duration_before = play.json()["duration_ms"]

    run = await client.post(
        "/api/v1/royalty-runs",
        headers=bearer(staff),
        json={"revenue_pool_id": frozen.json()["id"]},
    )
    assert run.status_code == 201, run.text
    assert run.json()["status"] == "CALCULATED"
    replay_run = await client.post(
        "/api/v1/royalty-runs",
        headers=bearer(staff),
        json={"revenue_pool_id": frozen.json()["id"]},
    )
    assert replay_run.status_code == 201
    assert replay_run.json()["id"] == run.json()["id"]
    assert len(replay_run.json()["lines"]) == len(run.json()["lines"])
    assert sum(line["amount_minor"] for line in run.json()["lines"]) + run.json()["unallocated_minor"] == 1000

    approved = await client.post(
        f"/api/v1/royalty-runs/{run.json()['id']}/lifecycle",
        headers=bearer(staff),
        json={"action": "approve"},
    )
    assert approved.status_code == 200, approved.text
    posted = await client.post(
        f"/api/v1/royalty-runs/{run.json()['id']}/lifecycle",
        headers=bearer(staff),
        json={"action": "post"},
    )
    assert posted.status_code == 200, posted.text
    assert posted.json()["status"] == "POSTED"

    mine = await client.get("/api/v1/me/royalties/statements", headers=bearer(artist_user["access_token"]))
    assert mine.status_code == 200, mine.text
    assert mine.json()["items"]
    statement_id = mine.json()["items"][0]["id"]
    issued = await client.post(
        f"/api/v1/statements/{statement_id}/lifecycle",
        headers=bearer(staff),
        json={"action": "issue"},
    )
    assert issued.status_code == 200, issued.text
    stolen = await client.get(
        f"/api/v1/statements/{statement_id}",
        headers=bearer(other["access_token"]),
    )
    assert stolen.status_code == 404
    own = await client.get(
        f"/api/v1/statements/{statement_id}",
        headers=bearer(artist_user["access_token"]),
    )
    assert own.status_code == 200
    assert own.json()["total_amount_minor"] == 1000

    adj = await client.post(
        f"/api/v1/statements/{statement_id}/adjustments",
        headers=bearer(staff),
        json={"amount_minor": 50, "reason": "correction"},
    )
    assert adj.status_code == 201, adj.text
    refreshed = await client.get(
        f"/api/v1/statements/{statement_id}",
        headers=bearer(artist_user["access_token"]),
    )
    assert refreshed.json()["total_amount_minor"] == 1000
    assert refreshed.json()["adjustments"][0]["amount_minor"] == 50

    settlement = await client.post(
        "/api/v1/settlements",
        headers=bearer(staff),
        json={"statement_id": statement_id},
    )
    assert settlement.status_code == 201, settlement.text
    approved_set = await client.post(
        f"/api/v1/settlements/{settlement.json()['id']}/approve",
        headers=bearer(staff),
    )
    assert approved_set.status_code == 200

    factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    async with factory() as session:
        event = await session.get(PlaybackEvent, UUID(str(playback_id)))
        assert event is not None
        assert event.duration_ms == duration_before
        assert event.eligible_hint == hint_before
        assert event.ignored is False
        rows = (await session.execute(select(PlaybackEvent))).scalars().all()
        assert any(row.id == event.id for row in rows)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase10_eligibility_fail_closed_without_policy(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    start, end = _period()
    created = await client.post(
        "/api/v1/royalty-rules",
        headers=bearer(staff),
        json={
            "key": "NO_ELIGIBILITY",
            "definition": {
                "pool_type": "PRO_RATA_BY_ELIGIBLE_PLAY",
                "right_type": "MASTER",
            },
        },
    )
    assert created.status_code == 201, created.text
    live = await client.post(
        f"/api/v1/royalty-rules/{created.json()['id']}/lifecycle",
        headers=bearer(staff),
        json={"action": "activate"},
    )
    assert live.status_code == 200
    await client.post(
        "/api/v1/recognized-revenue",
        headers={**bearer(staff), "Idempotency-Key": "rev-p10-empty"},
        json={
            "source_type": "STREAMING_SUB",
            "period_start": start,
            "period_end": end,
            "amount_minor": 250,
            "currency_code": "USD",
        },
    )
    pool = await client.post(
        "/api/v1/revenue-pools",
        headers=bearer(staff),
        json={
            "period_start": start,
            "period_end": end,
            "source_type": "STREAMING_SUB",
            "currency_code": "USD",
            "rule_id": live.json()["id"],
        },
    )
    frozen = await client.post(
        f"/api/v1/revenue-pools/{pool.json()['id']}/freeze",
        headers=bearer(staff),
    )
    assert frozen.status_code == 200
    run = await client.post(
        "/api/v1/royalty-runs",
        headers=bearer(staff),
        json={"revenue_pool_id": frozen.json()["id"]},
    )
    assert run.status_code == 201, run.text
    assert run.json()["unallocated_minor"] == 250
    assert run.json()["lines"] == []
    approve = await client.post(
        f"/api/v1/royalty-runs/{run.json()['id']}/lifecycle",
        headers=bearer(staff),
        json={"action": "approve"},
    )
    assert approve.status_code == 409
    assert approve.json()["code"] == "UNALLOCATED_REMAINDER"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_phase10_commerce_does_not_calculate_royalties(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    track = await _released_track(client, staff, "Commerce Track")
    product = await client.post(
        "/api/v1/products",
        headers=bearer(staff),
        json={"product_type": "TRACK", "subject_id": track["id"], "name": "SKU"},
    )
    assert product.status_code == 201, product.text
    assert "share_bps" not in product.json()
    assert "royalty" not in product.json()
