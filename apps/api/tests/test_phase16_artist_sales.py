"""Artist sales in Studio (HANDOFF 0.2 step 2): what fans paid, for the profile's owners only."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _released

LINE_KEYS = {
    "id", "subject_type", "subject_id", "title", "release_type", "quantity", "amount_minor",
    "refunded_amount_minor", "currency_code", "order_status", "ordered_at",
}


async def _order(client: AsyncClient, token: str, offer_id: str) -> dict:
    res = await client.post(
        "/api/v1/orders",
        headers={**bearer(token), "Idempotency-Key": f"k-{uuid4()}"},
        json={"offer_id": offer_id, "delivery_address_confirmed": True},
    )
    assert res.status_code == 201, res.text
    return res.json()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_owner_sees_paid_sales_and_refunds_without_buyers(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track, owner, artist_id = await _released(client, admin, label, "sales-owner@example.com", "Sales Act")
    ops = await _staff_with(client, admin, "sales-ops@example.com", "finance_manager", label)
    catalog = await _staff_with(client, admin, "sales-cat@example.com", "content_manager", label)
    queue = (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json()
    pid = next(p["id"] for p in queue if p["release_id"] == release_id)
    assert (await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(ops), json={"decision": "accept"})).status_code == 200
    offer_id = next(o["id"] for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)

    url = f"/api/v1/studio/profiles/artist/{artist_id}/sales"
    empty = await client.get(url, headers=bearer(owner["access_token"]))
    assert empty.status_code == 200, empty.text
    assert empty.json()["totals"] == [] and empty.json()["items"] == []

    buyers = []
    for n in range(2):
        fan = await register_and_login(client, f"sales-fan{n}@example.com")
        order = await _order(client, fan["access_token"], offer_id)
        paid = await client.post(f"/api/v1/payments/{order['payment']['id']}/sandbox-confirm", headers=bearer(fan["access_token"]))
        assert paid.status_code == 200, paid.text
        buyers.append((fan, order))
    # An order that was never paid is not a sale.
    waiting = await register_and_login(client, "sales-waiting@example.com")
    await _order(client, waiting["access_token"], offer_id)

    # A completed refund of part of the first sale (refunds are additive rows on the payment).
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.finance.domain.models_payments import Refund

    async with get_session_factory()() as session:
        session.add(
            Refund(
                payment_id=UUID(buyers[0][1]["payment"]["id"]), status="COMPLETED", amount_minor=1000,
                currency_code="BDT", reason_code="OTHER", idempotency_key=f"r-{uuid4()}",
            )
        )
        await session.commit()

    body = (await client.get(url, headers=bearer(owner["access_token"]))).json()
    assert body["profile"] == {"kind": "artist", "id": artist_id, "display_name": "Sales Act"}
    assert body["totals"] == [
        {"currency_code": "BDT", "sold_count": 2, "refunded_count": 0, "gross_amount_minor": 6000,
         "refunded_amount_minor": 1000, "net_amount_minor": 5000},
    ]
    [item] = body["items"]
    assert item["subject_type"] == "RELEASE" and item["subject_id"] == release_id
    assert item["title"] == "Review Me" and item["release_type"] == "SINGLE"
    assert item["net_amount_minor"] == 5000

    # Lines: newest first, paged, and nothing about who bought.
    lines = f"{url}/lines"
    first = await client.get(lines, headers=bearer(owner["access_token"]), params={"limit": 1})
    assert first.status_code == 200, first.text
    page1 = first.json()
    assert len(page1["items"]) == 1 and page1["next_cursor"]
    assert set(page1["items"][0]) == LINE_KEYS
    page2 = (await client.get(lines, headers=bearer(owner["access_token"]), params={"limit": 1, "cursor": page1["next_cursor"]})).json()
    assert len(page2["items"]) == 1 and page2["next_cursor"] is None
    assert page1["items"][0]["id"] != page2["items"][0]["id"]
    refunded = [i for i in page1["items"] + page2["items"] if i["refunded_amount_minor"]]
    assert [i["refunded_amount_minor"] for i in refunded] == [1000]
    everything = first.text + (await client.get(url, headers=bearer(owner["access_token"]))).text
    for fan, order in buyers:
        assert fan["user"]["id"] not in everything and fan["user"]["email"] not in everything
        assert order["id"] not in everything
    assert (await client.get(lines, headers=bearer(owner["access_token"]), params={"cursor": "garbled"})).status_code == 422

    # Finance staff of the label may look; catalog staff, fans and other artists may not.
    assert (await client.get(url, headers=bearer(ops))).status_code == 200
    assert (await client.get(url, headers=bearer(catalog))).status_code == 404
    assert (await client.get(lines, headers=bearer(catalog))).status_code == 404
    assert (await client.get(url, headers=bearer(buyers[0][0]["access_token"]))).status_code == 404
    other = await register_and_login(client, "sales-other@example.com")
    await _artist_for(other["user"]["id"], label, name="Someone Else")
    assert (await client.get(url, headers=bearer(other["access_token"]))).status_code == 404
