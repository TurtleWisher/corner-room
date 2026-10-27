"""D-ADDR-02 (owner, 2026-10-27): gift addresses anywhere in the world, phone numbers with their
country code. Bangladesh addresses keep their own shape and a Bangladesh mobile."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from cornerroom.modules.identity.domain.bd_address import clean_address, normalize_phone, phone_country_for
from cornerroom.modules.identity.domain.countries import BY_CODE, COUNTRIES
from cornerroom.infra.errors import AppError
from tests.auth_helpers import TEST_ADDRESS, bearer, register_and_login

UK = {
    "country_code": "GB",
    "recipient_name": "Nadia Rahman",
    "phone_country": "GB",
    "phone": "07700 900123",
    "address_line1": "12 Brick Lane",
    "address_line2": "Flat 3",
    "city": "London",
    "region": "",
    "postcode": "e1 6ra",
}


def test_country_table_is_complete_and_unique() -> None:
    codes = [c[0] for c in COUNTRIES]
    assert len(codes) == len(set(codes)) and len(codes) > 240
    assert BY_CODE["BD"] == ("BD", "Bangladesh", "880")
    assert all(len(c) == 2 and c.isupper() and d.isdigit() for c, _n, d in COUNTRIES)


def test_phone_numbers_become_international() -> None:
    assert normalize_phone("01712-345678", "BD") == "+8801712345678"
    assert normalize_phone("+880 1712 345678", "GB") == "+8801712345678"  # the + wins over the picker
    assert normalize_phone("01212345678", "BD") is None  # not a Bangladesh mobile
    assert normalize_phone("+880 2 9112345", "BD") is None  # Bangladesh numbers must be mobiles
    assert normalize_phone("07700 900123", "GB") == "+447700900123"
    assert normalize_phone("0044 7700 900123", "BD") == "+447700900123"
    assert normalize_phone("(212) 555-0187", "US") == "+12125550187"
    assert normalize_phone("06 1234 5678", "IT") == "+390612345678"  # Italy keeps its 0
    assert normalize_phone("050 123 4567", "AE") == "+971501234567"
    assert normalize_phone("12", "GB") is None
    assert normalize_phone("call me", "GB") is None
    assert phone_country_for("+12125550187", "CA") == "CA"  # shared +1 keeps the chosen country
    assert phone_country_for("+447700900123", "BD") == "GB"


def test_address_shapes() -> None:
    uk = clean_address(UK)
    assert uk["country_code"] == "GB" and uk["phone"] == "+447700900123" and uk["postcode"] == "E1 6RA"
    assert uk["division"] is None and uk["region"] is None
    bd = clean_address(TEST_ADDRESS)
    assert bd["country_code"] == "BD" and bd["address_line1"] is None and bd["phone_country"] == "BD"
    for over, field in (
        ({"country_code": "ZZ"}, "country_code"),
        ({"address_line1": " "}, "address_line1"),
        ({"city": ""}, "city"),
        ({"postcode": "!!"}, "postcode"),
        ({"phone": "123"}, "phone"),
    ):
        with pytest.raises(AppError) as err:
            clean_address(UK | over)
        assert err.value.extras["field"] == field


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_international_address_saved_and_shown(client: AsyncClient) -> None:
    options = (await client.get("/api/v1/address-options")).json()
    assert options["countries"][0] == {"code": "BD", "name": "Bangladesh", "calling_code": "880"}
    assert any(c["code"] == "GB" and c["calling_code"] == "44" for c in options["countries"])

    token = (await register_and_login(client, "address-abroad@example.com", delivery_address=False))["access_token"]
    saved = await client.put("/api/v1/me/delivery-address", headers=bearer(token), json=UK)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["country_code"] == "GB" and body["phone"] == "+447700900123" and body["city"] == "London"
    assert body["division"] is None

    # Switching back to Bangladesh clears the international fields.
    back = await client.put("/api/v1/me/delivery-address", headers=bearer(token), json=TEST_ADDRESS)
    assert back.status_code == 200, back.text
    assert back.json()["country_code"] == "BD" and back.json()["city"] is None and back.json()["address_line1"] is None
