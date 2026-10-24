"""Attack-style probes (security stage 1, owner 2026-10-24: "check any pro coder or experts can breach
the wall by doing any tricks"). Each test plays a trick an attacker would try and checks the wall.
"""

from __future__ import annotations

import asyncio
import hashlib
import struct
import zlib
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase3_media import _drain_jobs
from tests.test_phase05_ticketing import _on_sale_type, _open_ticketing, _platform_admin, _published_event
from tests.test_phase16_bangla_qr import _submit, _ticket_order


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_forged_and_borrowed_tokens_are_refused(client: AsyncClient, settings) -> None:
    fan = await register_and_login(client, "probe-token@example.com")
    good = jwt.decode(fan["access_token"], options={"verify_signature": False})
    now = int(datetime.now(UTC).timestamp())

    def forged(payload: dict, key: str = "not-the-secret", alg: str = "HS256") -> str:
        return jwt.encode(payload, key, algorithm=alg)

    attempts = {
        "no signature (alg none)": jwt.encode(good, None, algorithm="none") if hasattr(jwt, "encode") else "",
        "wrong key": forged(good),
        "expired": forged(good | {"exp": now - 60}, settings.jwt_secret),
        "other issuer": forged(good | {"iss": "evil"}, settings.jwt_secret),
        "cover link token used as login": forged(
            {"iss": settings.jwt_issuer, "aid": str(uuid4()), "exp": now + 600, "token_use": "cover"}, settings.media_secret
        ),
        "no session": forged({k: v for k, v in good.items() if k != "sid"}, settings.jwt_secret),
        "made-up session": forged(good | {"sid": str(uuid4())}, settings.jwt_secret),
        "garbage": "abc.def.ghi",
    }
    for name, token in attempts.items():
        res = await client.get("/api/v1/me", headers=bearer(token))
        assert res.status_code == 401, (name, res.status_code)
    # A real token still works, and a logged-out one stops working.
    assert (await client.get("/api/v1/me", headers=bearer(fan["access_token"]))).status_code == 200
    await client.post("/api/v1/auth/logout", headers=bearer(fan["access_token"]))
    assert (await client.get("/api/v1/me", headers=bearer(fan["access_token"]))).status_code == 401


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_many_buyers_at_once_cannot_oversell_tickets(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Rush Night")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=3, price=100)
    await _open_ticketing(client, staff, event["id"])
    buyers = [(await register_and_login(client, f"rush-{i}@example.com"))["access_token"] for i in range(8)]

    async def grab(token: str) -> int:
        res = await client.post("/api/v1/ticket-holds", headers=bearer(token), json={"ticket_type_id": ticket_type["id"], "quantity": 1})
        return res.status_code

    codes = await asyncio.gather(*(grab(t) for t in buyers))
    assert codes.count(201) == 3, codes
    assert all(c in {201, 409, 422} for c in codes), codes


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_one_payment_is_confirmed_once_even_when_clicked_together(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Double Click")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=10, price=100)
    await _open_ticketing(client, staff, event["id"])
    buyer = (await register_and_login(client, "double-click@example.com"))["access_token"]
    order = await _ticket_order(client, buyer, ticket_type["id"], "dc-1", quantity=2)
    assert (await _submit(client, buyer, order["payment"]["id"], "DC7A6B5C4D")).status_code == 201
    queue = (await client.get("/api/v1/staff/payment-submissions", headers=bearer(staff))).json()
    row = next(r for r in queue if r["order_id"] == order["id"])

    async def confirm() -> int:
        res = await client.post(f"/api/v1/staff/payment-submissions/{row['id']}/confirm", headers=bearer(staff))
        return res.status_code

    codes = await asyncio.gather(*(confirm() for _ in range(5)))
    assert codes.count(200) == 1, codes
    done = (await client.get(f"/api/v1/orders/{order['id']}", headers=bearer(buyer))).json()
    assert done["payment"]["status"] == "CAPTURED"
    tickets = (await client.get("/api/v1/me/tickets", headers=bearer(buyer))).json()["items"]
    assert len([t for t in tickets if t.get("event_id") == event["id"]]) == 2  # never 4 or 10

    # The same bank transaction ID can't pay for a second order.
    second = await _ticket_order(client, buyer, ticket_type["id"], "dc-2", quantity=1)
    reused = await _submit(client, buyer, second["payment"]["id"], "DC7A6B5C4D")
    assert reused.status_code == 409, reused.text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_extra_fields_cannot_change_what_they_should_not(client: AsyncClient) -> None:
    fan = await register_and_login(client, "mass-assign@example.com")
    token = fan["access_token"]
    sneaky = await client.patch(
        "/api/v1/me",
        headers=bearer(token),
        json={"display_name": "Plain Fan", "status": "SUSPENDED", "permissions": ["org.admin"], "email": "boss@example.com", "is_artist": True},
    )
    assert sneaky.status_code == 200
    me = (await client.get("/api/v1/me", headers=bearer(token))).json()
    assert me["display_name"] == "Plain Fan" and me["email"] == "mass-assign@example.com"
    assert me["permissions"] == [] or "org.admin" not in me["permissions"]
    assert me["status"] == "ACTIVE" and me["is_artist"] is False
    # Staff-only areas still refuse.
    assert (await client.get("/api/v1/staff/payment-submissions", headers=bearer(token))).status_code in {401, 403, 404, 409}


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_silly_numbers_and_huge_input_are_refused_cleanly(client: AsyncClient) -> None:
    staff, _org = await _platform_admin(client)
    event = await _published_event(client, staff, title="Odd Input")
    ticket_type = await _on_sale_type(client, staff, event["id"], quantity=5, price=100)
    await _open_ticketing(client, staff, event["id"])
    fan = (await register_and_login(client, "odd-input@example.com"))["access_token"]

    for quantity in (0, -1, 10**9):
        res = await client.post("/api/v1/ticket-holds", headers=bearer(fan), json={"ticket_type_id": ticket_type["id"], "quantity": quantity})
        assert res.status_code in {409, 422}, (quantity, res.status_code)
    for price in (-1, 10**20):
        res = await client.post(
            "/api/v1/ticket-types",
            headers=bearer(staff),
            json={"event_id": event["id"], "name": "Bad", "price_amount_minor": price, "currency_code": "BDT", "quantity_total": 1},
        )
        assert res.status_code == 422, (price, res.status_code)
    assert (await client.patch("/api/v1/me", headers=bearer(fan), json={"display_name": "x" * 10_000})).status_code == 422
    assert (await client.get("/api/v1/search", params={"q": "' OR 1=1 --" * 500})).status_code < 500
    assert (await client.get("/api/v1/releases/not-a-uuid")).status_code == 422
    assert (await client.post("/api/v1/auth/login", content=b"{not json", headers={"Content-Type": "application/json"})).status_code == 422


def _png_header_only(width: int, height: int) -> bytes:
    """A tiny PNG whose header claims a gigantic size (a "decompression bomb")."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00" * 16)) + chunk(b"IEND", b"")


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_booby_trapped_uploads_are_turned_down(client: AsyncClient) -> None:
    fan = await register_and_login(client, "bomb@example.com")
    token, user_id = fan["access_token"], fan["user"]["id"]

    async def upload(data: bytes, filename: str) -> dict:
        intent = await client.post(
            "/api/v1/uploads/intents",
            headers=bearer(token),
            json={"purpose": "COVER_ART", "target_type": "user_avatar", "target_id": user_id, "filename": filename, "byte_size": len(data)},
        )
        assert intent.status_code == 201, intent.text
        it = intent.json()
        put = await client.put(
            f"/api/v1/uploads/intents/{it['id']}/parts/1",
            headers={**bearer(token), "X-Part-SHA256": hashlib.sha256(data).hexdigest()},
            content=data,
        )
        assert put.status_code == 200, put.text
        done = await client.post(f"/api/v1/uploads/intents/{it['id']}/complete", headers=bearer(token))
        assert done.status_code in {200, 422}, done.text
        await _drain_jobs()
        return it

    # A path trick in the file name is cut down to a plain name.
    it = await upload(_png_header_only(500, 500), "../../../etc/passwd.png")
    assert "/" not in it["filename"] and ".." not in it["filename"].replace("passwd", "")
    # Its header says 500 x 500 but there is no real picture inside: turned down as unreadable.
    report = (await client.get("/api/v1/me/avatar-report", headers=bearer(token))).json()
    assert report["asset_status"] == "REJECTED" and "COVER_UNREADABLE" in {f["code"] for f in report["findings"]}, report

    # A picture claiming 100,000 x 100,000 pixels is turned down, not decoded.
    await upload(_png_header_only(100_000, 100_000), "bomb.png")
    report = (await client.get("/api/v1/me/avatar-report", headers=bearer(token))).json()
    assert report["asset_status"] == "REJECTED", report
    assert (await client.get("/api/v1/me", headers=bearer(token))).json()["avatar_url"] is None

    # Something that is not an image at all, named .png.
    await upload(b"<?php system($_GET['c']); ?>" * 20, "shell.png")
    report = (await client.get("/api/v1/me/avatar-report", headers=bearer(token))).json()
    assert report["asset_status"] == "REJECTED", report

    # A declared size that doesn't match what arrives is refused at once.
    lie = await client.post(
        "/api/v1/uploads/intents",
        headers=bearer(token),
        json={"purpose": "COVER_ART", "target_type": "user_avatar", "target_id": user_id, "filename": "x.png", "byte_size": 10},
    )
    bad_part = await client.put(
        f"/api/v1/uploads/intents/{lie.json()['id']}/parts/1",
        headers={**bearer(token), "X-Part-SHA256": hashlib.sha256(b"y" * 5000).hexdigest()},
        content=b"y" * 5000,
    )
    assert bad_part.status_code in {409, 413, 422}, bad_part.text


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_signed_media_links_cannot_be_forged_or_stretched(client: AsyncClient, settings) -> None:
    now = datetime.now(UTC)
    fake = jwt.encode(
        {"iss": settings.jwt_issuer, "aid": str(uuid4()), "exp": int((now + timedelta(days=365)).timestamp()), "token_use": "cover"},
        "guessed-key",
        algorithm="HS256",
    )
    assert (await client.get(f"/api/v1/covers/signed/{fake}/480")).status_code == 401
    expired = jwt.encode(
        {"iss": settings.jwt_issuer, "aid": str(uuid4()), "exp": int((now - timedelta(minutes=1)).timestamp()), "token_use": "cover"},
        settings.media_secret,
        algorithm="HS256",
    )
    assert (await client.get(f"/api/v1/covers/signed/{expired}/480")).status_code == 401
    assert (await client.get("/api/v1/playback/media/not-a-real-token")).status_code in {401, 403, 404}
