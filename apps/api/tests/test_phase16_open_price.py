"""Open price (D-OPEN-PRICE-01): the buyer chooses what to pay, from the agreed lowest amount up."""

from __future__ import annotations

import pytest

from cornerroom.infra.errors import AppError
from cornerroom.modules.commerce.domain.open_price import amount_to_charge, assert_can_be_open


def test_fixed_price_is_charged_as_agreed() -> None:
    assert amount_to_charge(lowest_minor=10_000, open_price=False, chosen_minor=None) == 10_000
    # Sending the same amount back changes nothing.
    assert amount_to_charge(lowest_minor=10_000, open_price=False, chosen_minor=10_000) == 10_000


def test_fixed_price_takes_no_other_amount() -> None:
    for chosen in (1, 9_999, 10_001, 1_000_000):
        with pytest.raises(AppError) as err:
            amount_to_charge(lowest_minor=10_000, open_price=False, chosen_minor=chosen)
        assert err.value.code == "PRICE_IS_FIXED"


def test_open_price_defaults_to_the_lowest_amount() -> None:
    assert amount_to_charge(lowest_minor=10_000, open_price=True, chosen_minor=None) == 10_000


def test_open_price_takes_any_amount_from_the_lowest_up() -> None:
    assert amount_to_charge(lowest_minor=10_000, open_price=True, chosen_minor=10_000) == 10_000
    assert amount_to_charge(lowest_minor=10_000, open_price=True, chosen_minor=1_000_000) == 1_000_000


def test_open_price_refuses_less_than_the_lowest_amount() -> None:
    with pytest.raises(AppError) as err:
        amount_to_charge(lowest_minor=10_000, open_price=True, chosen_minor=9_999)
    assert err.value.code == "AMOUNT_TOO_LOW"
    assert err.value.status == 422


def test_the_limit_applies_only_when_set() -> None:
    assert amount_to_charge(lowest_minor=100, open_price=True, chosen_minor=10**12, max_minor=0) == 10**12
    assert amount_to_charge(lowest_minor=100, open_price=True, chosen_minor=5_000, max_minor=5_000) == 5_000
    with pytest.raises(AppError) as err:
        amount_to_charge(lowest_minor=100, open_price=True, chosen_minor=5_001, max_minor=5_000)
    assert err.value.code == "AMOUNT_TOO_HIGH"


def test_open_price_is_for_the_normal_price_only() -> None:
    assert_can_be_open(audience="EVERYONE", amount_minor=10_000)
    for audience in ("PRESALE", "OWNS_PART_OF_RELEASE"):
        with pytest.raises(AppError):
            assert_can_be_open(audience=audience, amount_minor=10_000)


def test_open_price_needs_a_lowest_amount_above_zero() -> None:
    with pytest.raises(AppError):
        assert_can_be_open(audience="EVERYONE", amount_minor=0)


# Owner, 2026-11-17 (Q-OPEN-01, Q-OPEN-02): every open-price amount is between ৳10 and ৳100,000.
MIN, MAX = 1_000, 10_000_000


def test_the_artists_lowest_must_be_inside_the_range() -> None:
    assert_can_be_open(audience="EVERYONE", amount_minor=MIN, min_minor=MIN, max_minor=MAX)
    assert_can_be_open(audience="EVERYONE", amount_minor=MAX, min_minor=MIN, max_minor=MAX)
    with pytest.raises(AppError) as low:
        assert_can_be_open(audience="EVERYONE", amount_minor=999, min_minor=MIN, max_minor=MAX)
    assert low.value.code == "AMOUNT_TOO_LOW"
    with pytest.raises(AppError) as high:
        assert_can_be_open(audience="EVERYONE", amount_minor=MAX + 1, min_minor=MIN, max_minor=MAX)
    assert high.value.code == "AMOUNT_TOO_HIGH"


def test_a_buyer_pays_between_the_artists_lowest_and_the_top_of_the_range() -> None:
    # ৳100 lowest: ৳100 and ৳100,000 are fine, ৳99 and ৳100,000.01 are not.
    assert amount_to_charge(lowest_minor=10_000, open_price=True, chosen_minor=10_000, min_minor=MIN, max_minor=MAX) == 10_000
    assert amount_to_charge(lowest_minor=10_000, open_price=True, chosen_minor=MAX, min_minor=MIN, max_minor=MAX) == MAX
    for chosen, code in ((9_900, "AMOUNT_TOO_LOW"), (MAX + 1, "AMOUNT_TOO_HIGH")):
        with pytest.raises(AppError) as err:
            amount_to_charge(lowest_minor=10_000, open_price=True, chosen_minor=chosen, min_minor=MIN, max_minor=MAX)
        assert err.value.code == code


def test_the_floor_of_the_range_wins_over_an_older_lower_price() -> None:
    # An offer agreed before the range existed at ৳5 is charged at least ৳10.
    assert amount_to_charge(lowest_minor=500, open_price=True, chosen_minor=None, min_minor=MIN, max_minor=MAX) == MIN
    with pytest.raises(AppError):
        amount_to_charge(lowest_minor=500, open_price=True, chosen_minor=600, min_minor=MIN, max_minor=MAX)


def test_a_fixed_price_is_never_held_to_the_open_price_range() -> None:
    assert amount_to_charge(lowest_minor=500, open_price=False, chosen_minor=None, min_minor=MIN, max_minor=MAX) == 500


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_open_price_from_studio_to_a_paid_order(client) -> None:
    """D-OPEN-PRICE-01 end to end: the artist proposes an open price, staff accept it, the Store
    shows the floor and the top of the range, and a buyer pays their own amount within it."""
    from uuid import uuid4

    from tests.auth_helpers import bearer, register_and_login
    from tests.test_audio_phase5_intake import _orgs, _staff_with
    from tests.test_audio_phase7_release_commerce import _released

    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, _track, owner, _artist = await _released(client, admin, label, "op-owner@example.com", "Open Act")
    ops = await _staff_with(client, admin, "op-ops@example.com", "finance_manager", label)
    fan = await register_and_login(client, "op-fan@example.com")
    studio = bearer(owner["access_token"])

    def proposal(amount: int, **extra) -> dict:
        return {"subject_type": "RELEASE", "subject_id": release_id, "amount_minor": amount, "currency_code": "BDT", "open_price": True, **extra}

    url = f"/api/v1/studio/releases/{release_id}/price-proposals"
    # Outside the owner's range (৳10 to ৳100,000), and never for a pre-sale.
    assert (await client.post(url, headers=studio, json=proposal(999))).status_code == 422
    assert (await client.post(url, headers=studio, json=proposal(10_000_001))).status_code == 422
    assert (await client.post(url, headers=studio, json=proposal(5_000, audience="PRESALE"))).status_code in (409, 422)
    made = await client.post(url, headers=studio, json=proposal(10_000))
    assert made.status_code == 201, made.text
    assert made.json()["open_price"] is True
    detail = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=studio)).json()
    assert detail["open_price_range"] == {"min_minor": 1_000, "max_minor": 10_000_000, "currency_code": "BDT"}

    queue = (await client.get("/api/v1/offer-proposals", headers=bearer(ops))).json()
    mine = next(p for p in queue if p["release_id"] == release_id and p["open_price"])
    assert mine["amount_minor"] == 10_000
    accepted = await client.post(f"/api/v1/offer-proposals/{mine['id']}/decision", headers=bearer(ops), json={"decision": "accept"})
    assert accepted.status_code == 200, accepted.text

    offers = (await client.get("/api/v1/offers")).json()["items"]
    offer = next(o for o in offers if o.get("subject_id") == release_id and o.get("audience") == "EVERYONE")
    assert offer["open_price"] is True
    assert offer["open_price_min_minor"] == 10_000 and offer["open_price_max_minor"] == 10_000_000

    def order(amount: int | None) -> dict:
        body = {"offer_id": offer["id"], "delivery_address_confirmed": True}
        if amount is not None:
            body["amount_minor"] = amount
        return body

    buyer = bearer(fan["access_token"])
    low = await client.post("/api/v1/orders", headers={**buyer, "Idempotency-Key": f"k-{uuid4()}"}, json=order(9_999))
    assert low.status_code == 422 and low.json()["code"] == "AMOUNT_TOO_LOW"
    high = await client.post("/api/v1/orders", headers={**buyer, "Idempotency-Key": f"k-{uuid4()}"}, json=order(10_000_001))
    assert high.status_code == 422 and high.json()["code"] == "AMOUNT_TOO_HIGH"
    placed = await client.post("/api/v1/orders", headers={**buyer, "Idempotency-Key": f"k-{uuid4()}"}, json=order(250_000))
    assert placed.status_code == 201, placed.text
    assert placed.json()["total_amount_minor"] == 250_000
    assert placed.json()["payment"]["amount_minor"] == 250_000
    paid = await client.post(f"/api/v1/payments/{placed.json()['payment']['id']}/sandbox-confirm", headers=buyer)
    assert paid.status_code == 200, paid.text
    assert paid.json()["status"] == "FULFILLED"
