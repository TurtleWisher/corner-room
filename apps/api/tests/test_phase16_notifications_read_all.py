"""Opening the notifications list reads them all, so the bell clears (owner, 2026-10-27)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.auth_helpers import bearer, register_and_login


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_read_all_clears_every_unread_notification_for_this_person_only(client: AsyncClient) -> None:
    from cornerroom.worker import drain_outbox

    me = await register_and_login(client, "bell-me@example.com")
    other = await register_and_login(client, "bell-other@example.com")
    while await drain_outbox({}):
        pass
    mine = (await client.get("/api/v1/me/notifications", headers=bearer(me["access_token"]))).json()
    assert any(n["status"] == "UNREAD" for n in mine)

    done = await client.post("/api/v1/me/notifications/read-all", headers=bearer(me["access_token"]))
    assert done.status_code == 200 and done.json()["marked"] >= 1
    after = (await client.get("/api/v1/me/notifications", headers=bearer(me["access_token"]))).json()
    assert after and all(n["status"] == "READ" and n["read_at"] for n in after)
    # Nothing left: a second call changes nothing; someone else's stay unread.
    assert (await client.post("/api/v1/me/notifications/read-all", headers=bearer(me["access_token"]))).json() == {"marked": 0}
    theirs = (await client.get("/api/v1/me/notifications", headers=bearer(other["access_token"]))).json()
    assert any(n["status"] == "UNREAD" for n in theirs)
    # Signed out: refused.
    assert (await client.post("/api/v1/me/notifications/read-all")).status_code == 401
