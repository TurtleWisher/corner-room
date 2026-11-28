"""Corner Room Wrap (owner, 2026-11-28, D-WRAP-01): each person's look back at a period, built from
what they really did, run end to end by platform staff."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from cornerroom.infra.errors import AppError
from cornerroom.modules.analytics.domain import wraps as rules
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase7_release_commerce import _released

D = rules.DHAKA


def _row(track: UUID, act: UUID | None, day: date, hour: int = 12, ms: int = 180_000) -> rules.ListenRow:
    return rules.ListenRow(track_id=track, act_id=act, listened_ms=ms, day=day, counted_at=datetime(day.year, day.month, day.day, hour, tzinfo=D))


# --- pure rules -------------------------------------------------------------------------------------


def test_the_wrap_calls_people_by_a_name_without_digits() -> None:
    from cornerroom.modules.analytics.application.wraps import first_name

    assert first_name("Samiul Islam") == "Samiul"
    assert first_name("Mizuls1 Samiul") == "Samiul"
    assert first_name("2026 fan") == "fan"
    assert first_name("R2D2") is None
    assert first_name(None) is None and first_name("   ") is None


def test_longest_streak_finds_the_first_longest_run() -> None:
    d = date(2026, 3, 1)
    days = [d, d + timedelta(1), d + timedelta(2), d + timedelta(5), d + timedelta(6), d + timedelta(7)]
    assert rules.longest_streak(days) == (3, d, d + timedelta(2))
    assert rules.longest_streak([]) == (0, None, None)
    assert rules.longest_streak([d, d]) == (1, d, d)


def test_summary_counts_only_the_period_and_ranks_by_listens() -> None:
    a, b, c = uuid4(), uuid4(), uuid4()
    act1, act2 = uuid4(), uuid4()
    start, end = date(2026, 1, 1), date(2026, 12, 31)
    rows = [
        _row(a, act1, date(2026, 1, 5), hour=23),
        _row(a, act1, date(2026, 1, 6), hour=23),
        _row(a, act1, date(2026, 2, 6), hour=1),
        _row(b, act2, date(2026, 2, 7), hour=9),
        _row(c, act1, date(2025, 12, 30)),  # before the period: not counted
    ]
    out = rules.summarise_listens(rows, starts_on=start, ends_on=end, top_count=5, first_heard={a: date(2026, 1, 5), b: date(2025, 6, 1)})
    assert out["listens"] == 4
    assert out["minutes"] == 12
    assert [s["track_id"] for s in out["top_songs"]] == [a, b]
    assert out["top_acts"][0] == {"act_id": act1, "listens": 3, "songs": 1}
    assert out["day_part"] == "NIGHT_OWL" and out["peak_hour"] == 23
    assert out["streak"]["days"] == 2
    assert out["busiest_day"]["listens"] == 1
    assert [m["listens"] for m in out["months"]][:3] == [2, 2, 0] and len(out["months"]) == 12
    # b was first heard before the period: only a is new, and only act1 is new to the person.
    assert out["new_songs"] == 1 and out["new_acts"] == 1
    assert out["first_song"]["track_id"] == a


def test_fan_rank_is_a_share_and_waits_for_enough_listeners() -> None:
    assert rules.fan_rank(10, [10, 3, 2], min_listeners=10) is None
    rank = rules.fan_rank(10, [10, 3, 2, 1, 1, 1, 1, 1, 1, 1], min_listeners=10)
    assert rank == {"rank": 1, "listeners": 10, "top_percent": 10}
    assert rules.fan_rank(1, [5, 4, 1, 1], min_listeners=1) == {"rank": 3, "listeners": 4, "top_percent": 75}
    assert rules.fan_rank(0, [5], min_listeners=1) is None


def test_settings_are_checked_and_keep_their_card_order() -> None:
    s = rules.clean_settings({"cards": [{"key": "SUMMARY", "on": True}, {"key": "INTRO", "on": False, "title": "  Hello   {first_name} "}]})
    assert [c["key"] for c in s["cards"]][:2] == ["SUMMARY", "INTRO"]
    assert s["cards"][1]["title"] == "Hello {first_name}"
    # Cards not sent join at the end, switched off.
    assert all(not c["on"] for c in s["cards"][2:]) and len(s["cards"]) == len(rules.CARD_KEYS)
    for bad in (
        {"look": "NEON"},
        {"slide_seconds": 99},
        {"dither": {"style": "BAYER", "cell": 1, "motion": "LIVELY"}},
        {"rules": {"min_listens": -1, "top_count": 5, "fan_rank_min_listeners": 10}},
        {"rules": {"min_listens": 1, "top_count": 50, "fan_rank_min_listeners": 10}},
        {"cards": [{"key": k, "on": False} for k in rules.CARD_KEYS]},
        {"tagline": "  "},
        {"cards": [{"key": "INTRO", "on": True, "title": "x" * 200}]},
    ):
        with pytest.raises(AppError):
            rules.clean_settings(bad)


def test_moves_and_when_fans_can_open_it() -> None:
    rules.check_transition("DRAFT", "LIVE")
    rules.check_transition("LIVE", "ENDED")
    with pytest.raises(AppError) as err:
        rules.check_transition("DRAFT", "ENDED")
    assert err.value.code == "INVALID_TRANSITION"
    now = datetime(2026, 12, 1, tzinfo=UTC)
    assert rules.fan_state("DRAFT", None, None, now) == "CLOSED"
    assert rules.fan_state("LIVE", None, None, now) == "OPEN"
    assert rules.fan_state("LIVE", now + timedelta(hours=1), None, now) == "SOON"
    assert rules.fan_state("LIVE", None, now, now) == "CLOSED"
    with pytest.raises(AppError):
        rules.check_period(date(2026, 2, 1), date(2026, 1, 1))
    with pytest.raises(AppError):
        rules.check_window(now, now)


def test_cards_show_only_with_something_real_to_say() -> None:
    settings = rules.merged_settings({})
    empty = {"listens": 0, "top_songs": [], "top_acts": [], "months": [], "peak_hour": None}
    assert [c["key"] for c in rules.cards_for(settings, empty)] == ["INTRO", "SUMMARY"]
    assert not rules.has_enough(empty, 1)
    assert rules.has_enough({**empty, "bought": {"songs": 1}}, 0)
    assert not rules.has_enough({**empty, "listens": 2}, 3)


# --- with the database ------------------------------------------------------------------------------


async def _listen(user_id: str, track_id: str, when: datetime, ms: int = 200_000) -> None:
    from cornerroom.infra.db import get_session_factory
    from cornerroom.modules.streaming.domain.models import Listen, ListeningSession

    async with get_session_factory()() as session:
        ls = ListeningSession(user_id=UUID(user_id), started_at=when, status="CLOSED")
        session.add(ls)
        await session.flush()
        session.add(
            Listen(user_id=UUID(user_id), track_id=UUID(track_id), session_id=ls.id, listened_ms=ms, listen_day=when.astimezone(D).date(), counted_at=when)
        )
        await session.commit()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_staff_run_a_wrap_and_fans_open_their_own(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    _release_id, track_id, _owner, _artist = await _released(client, admin, label, "wr-owner@example.com", "Wrap Act")
    label_staff = await _staff_with(client, admin, "wr-staff@example.com", "content_manager", label)
    fan = await register_and_login(client, "wr-fan@example.com", display_name="Mitu Rahman")
    quiet = await register_and_login(client, "wr-quiet@example.com")
    today = datetime.now(UTC).astimezone(D).date()
    start = today - timedelta(days=30)
    for days_ago in (3, 2, 1):
        await _listen(fan["user"]["id"], track_id, datetime.now(UTC) - timedelta(days=days_ago))

    # Only platform admins run Wraps; a label's own staff and fans get 404.
    for token in (fan["access_token"], label_staff):
        assert (await client.get("/api/v1/staff/wraps", headers=bearer(token))).status_code == 404
        assert (await client.post("/api/v1/staff/wraps", headers=bearer(token), json={"name": "X", "starts_on": str(start), "ends_on": str(today)})).status_code == 404

    made = await client.post("/api/v1/staff/wraps", headers=bearer(admin), json={"name": "Corner Room Wrap", "starts_on": str(start), "ends_on": str(today)})
    assert made.status_code == 201, made.text
    wrap = made.json()
    wid = wrap["id"]
    assert wrap["status"] == "DRAFT" and wrap["transitions"] == ["LIVE"]

    # A draft is invisible to fans, but staff preview it with their own activity.
    assert (await client.get(f"/api/v1/wraps/{wid}", headers=bearer(fan["access_token"]))).status_code == 404
    assert (await client.get("/api/v1/wraps", headers=bearer(fan["access_token"]))).json()["items"] == []
    preview = await client.get(f"/api/v1/wraps/{wid}?preview=true", headers=bearer(admin))
    assert preview.status_code == 200 and preview.json()["preview"] is True

    # Settings: checked, versioned.
    settings = wrap["settings"]
    settings["look"] = "CAROUSEL"
    settings["cards"][0]["title"] = "Hey {first_name}"
    saved = await client.put(f"/api/v1/staff/wraps/{wid}", headers=bearer(admin), json={"version": wrap["version"], "settings": settings})
    assert saved.status_code == 200, saved.text
    stale = await client.put(f"/api/v1/staff/wraps/{wid}", headers=bearer(admin), json={"version": wrap["version"], "name": "Old"})
    assert stale.status_code == 409 and stale.json()["code"] == "STALE_VERSION"
    bad = await client.put(f"/api/v1/staff/wraps/{wid}", headers=bearer(admin), json={"version": saved.json()["version"], "settings": {**settings, "look": "NEON"}})
    assert bad.status_code == 422

    live = await client.post(f"/api/v1/staff/wraps/{wid}/transition", headers=bearer(admin), json={"to": "LIVE"})
    assert live.status_code == 200 and live.json()["status"] == "LIVE"

    mine = await client.get(f"/api/v1/wraps/{wid}", headers=bearer(fan["access_token"]))
    assert mine.status_code == 200, mine.text
    body = mine.json()
    assert body["enough"] is True and body["person"]["first_name"] == "Mitu"
    assert body["season"]["look"] == "CAROUSEL"
    assert body["stats"]["listens"] == 3 and body["stats"]["top_songs"][0]["track_id"] == track_id
    assert body["stats"]["top_songs"][0]["act"] == "Wrap Act"
    assert body["cards"][0] == {"key": "INTRO", "title": "Hey {first_name}"}
    keys = [c["key"] for c in body["cards"]]
    assert "MINUTES" in keys and "STREAK" in keys and "SUMMARY" in keys
    # Never money in a Wrap.
    assert "amount_minor" not in mine.text

    # Kept: a new listen doesn't change the numbers until staff rebuild.
    await _listen(fan["user"]["id"], track_id, datetime.now(UTC) - timedelta(hours=1))
    again = (await client.get(f"/api/v1/wraps/{wid}", headers=bearer(fan["access_token"]))).json()
    assert again["stats"]["listens"] == 3
    rebuilt = await client.post(f"/api/v1/staff/wraps/{wid}/rebuild", headers=bearer(admin))
    assert rebuilt.status_code == 200 and rebuilt.json()["cleared"] == 1
    assert (await client.get(f"/api/v1/wraps/{wid}", headers=bearer(fan["access_token"]))).json()["stats"]["listens"] == 4

    # Someone with no listens gets the "not yet" page, not empty cards.
    nothing = (await client.get(f"/api/v1/wraps/{wid}", headers=bearer(quiet["access_token"]))).json()
    assert nothing["enough"] is False and nothing["cards"] == []

    # Counts only: shares and finishes add up, nothing about who.
    for kind in ("FINISHED", "SHARED_SHEET", "SHARED_SHEET"):
        assert (await client.post(f"/api/v1/wraps/{wid}/count", headers=bearer(fan["access_token"]), json={"kind": kind})).status_code == 204
    numbers = (await client.get(f"/api/v1/staff/wraps/{wid}", headers=bearer(admin))).json()
    assert numbers["numbers"]["shared_sheet"] == 2 and numbers["numbers"]["finished"] == 1
    assert numbers["numbers"]["opened"] == 3 and numbers["people_with_listens"] >= 1

    # It ends; a Wrap people saw can't be deleted.
    ended = await client.post(f"/api/v1/staff/wraps/{wid}/transition", headers=bearer(admin), json={"to": "ENDED"})
    assert ended.status_code == 200 and ended.json()["fan_state"] == "CLOSED"
    assert (await client.get(f"/api/v1/wraps/{wid}", headers=bearer(fan["access_token"]))).status_code == 404
    gone = await client.delete(f"/api/v1/staff/wraps/{wid}", headers=bearer(admin))
    assert gone.status_code == 409 and gone.json()["code"] == "WAS_LIVE"
