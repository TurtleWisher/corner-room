"""All customers (owner, 2026-10-27, D-CUSTOMERS-01): website accounts and pre-sale buyers in one
list for admins and finance staff, filterable to one artist's or band's buyers. Pre-sale buyers
keep their phone and address from the sheet, and uploading the sheet again fills in what was
missing."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _released
from tests.test_phase16_presales import _mark_verified


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_admins_and_platform_finance_see_every_customer_with_contact_details(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    release_id, track_id, _owner, artist_id = await _released(client, admin, label, "cust-artist@example.com", "Cust Act")
    # Every song list knows the song's release, so release buyers see it as theirs (owner, 2026-10-27).
    catalog = {t["id"]: t for t in (await client.get("/api/v1/playback/catalog")).json()["items"]}
    assert catalog[track_id]["release_ids"] == [release_id]
    finance = await _staff_with(client, admin, "cust-fin@example.com", "finance_manager", label)
    queue = (await client.get("/api/v1/offer-proposals", headers=bearer(finance))).json()
    pid = next(p["id"] for p in queue if p["release_id"] == release_id)
    await client.post(f"/api/v1/offer-proposals/{pid}/decision", headers=bearer(finance), json={"decision": "accept"})
    product_id = next(o["product_id"] for o in (await client.get("/api/v1/offers")).json()["items"] if o.get("subject_id") == release_id)

    fan = await register_and_login(client, "cust-early@example.com")
    await _mark_verified("cust-early@example.com")
    first = await client.post(
        "/api/v1/staff/presales",
        headers=bearer(finance),
        json={"product_id": product_id, "rows": [
            {"email": "cust-early@example.com", "buyer_name": "Early Fan", "amount_minor": 11400},
            {"email": "cust-waiting@example.com", "buyer_name": "Waiting Fan", "amount_minor": 11400,
             "phone": "01700 000000", "address": "House 1,  Road 2, Dhanmondi"},
        ]},
    )
    assert first.status_code == 201, first.text
    # The same sheet again, now with a phone for the early fan: it is filled in, nobody is duplicated.
    again = await client.post(
        "/api/v1/staff/presales",
        headers=bearer(finance),
        json={"product_id": product_id, "rows": [{"email": "cust-early@example.com", "amount_minor": 11400, "phone": "+8801711111111"}]},
    )
    assert again.json()["added"] == 0 and again.json()["contact_filled"] == 1

    listing = await client.get("/api/v1/staff/customers", headers=bearer(admin))
    assert listing.status_code == 200, listing.text
    by_email = {r["email"]: r for r in listing.json()["items"]}
    early = by_email["cust-early@example.com"]
    assert early["user_id"] == fan["user"]["id"] and set(early["sources"]) == {"WEBSITE", "PRESALE"}
    # The account's own phone wins over the sheet's; the sheet's is kept on the pre-sale row.
    assert early["phone"] == "+8801712345678" and early["orders"] == 1 and early["spent"] == {"BDT": 11400}
    sheet = (await client.get("/api/v1/staff/presales", headers=bearer(finance), params={"product_id": product_id})).json()
    assert {r["email"]: r["phone"] for r in sheet["items"]}["cust-early@example.com"] == "+8801711111111"
    assert early["presales"][0]["status"] == "CLAIMED"
    waiting = by_email["cust-waiting@example.com"]
    assert waiting["user_id"] is None and waiting["sources"] == ["PRESALE"]
    assert waiting["phone"] == "01700 000000" and waiting["address"] == "House 1, Road 2, Dhanmondi"
    # Everyone with an account is in the full list, buyer or not.
    assert "cust-artist@example.com" in by_email

    # Filtered to this artist: only its buyers and pre-sale buyers.
    mine = (
        await client.get("/api/v1/staff/customers", headers=bearer(admin), params={"profile_kind": "artist", "profile_id": artist_id})
    ).json()
    assert sorted(r["email"] for r in mine["items"]) == ["cust-early@example.com", "cust-waiting@example.com"]
    assert mine["presale_buyers"] == 2 and mine["website_customers"] == 1

    # One song's or one release's buyers: the same people here (the song is sold with its release).
    for scope, scope_id in (("track", track_id), ("release", release_id)):
        scoped = (
            await client.get("/api/v1/staff/customers", headers=bearer(admin), params={"scope": scope, "scope_id": scope_id})
        ).json()
        assert sorted(r["email"] for r in scoped["items"]) == ["cust-early@example.com", "cust-waiting@example.com"], scope

    # Followers of the artist, for CSV export; staff only.
    assert (await client.post(f"/api/v1/artists/{artist_id}/follow", headers=bearer(fan["access_token"]))).status_code == 201
    followers = await client.get("/api/v1/staff/followers", headers=bearer(admin), params={"kind": "artist", "target_id": artist_id})
    assert followers.status_code == 200, followers.text
    assert [f["email"] for f in followers.json()["items"]] == ["cust-early@example.com"]
    assert (
        await client.get("/api/v1/staff/followers", headers=bearer(fan["access_token"]), params={"kind": "artist", "target_id": artist_id})
    ).status_code == 404

    # Search by phone.
    found = (await client.get("/api/v1/staff/customers", headers=bearer(admin), params={"q": "01700"})).json()
    assert [r["email"] for r in found["items"]] == ["cust-waiting@example.com"]

    # A label's finance staff, fans and artists can't see it (404); platform finance can.
    assert (await client.get("/api/v1/staff/customers", headers=bearer(finance))).status_code == 404
    assert (await client.get("/api/v1/staff/customers", headers=bearer(fan["access_token"]))).status_code == 404
    platform_finance = await _staff_with(client, admin, "cust-pfin@example.com", "finance_manager", orgs["PLATFORM"])
    assert (await client.get("/api/v1/staff/customers", headers=bearer(platform_finance))).status_code == 200
