"""Corner Room Wrap (owner, 2026-11-28, D-WRAP-01): a personal look back at a stretch of time.

Platform staff run each Wrap end to end: its name and words, the period of activity it covers, when
fans can open it and when it closes, its carnival look and dither, which cards show and in what
order (with their own headlines), the thresholds for who gets one, and whether it can be shared.

Every number on a card comes from what the person really did in the period: counted listens
(D-LISTEN-01), music they bought (orders that are still theirs, never test buys), tickets to events
in the period, gifts and follows. Never money (analytics honesty), never who pressed what, and
nothing about anyone else except a rank among an act's listeners, given only as a share.

This file holds the tables and the pure rules; `application/wraps.py` reads the database.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import ActorMixin, Base, TimestampMixin, UUIDPrimaryKeyMixin
from cornerroom.infra.errors import AppError

# Bangladesh has no daylight saving; listen days are already Dhaka dates (streaming service).
DHAKA = timezone(timedelta(hours=6), "Dhaka")

DRAFT, LIVE, ENDED = "DRAFT", "LIVE", "ENDED"
STATUSES = (DRAFT, LIVE, ENDED)
# Moves staff can make; the page shows only these (never a hard-coded list in the UI).
TRANSITIONS: dict[str, tuple[str, ...]] = {
    DRAFT: (LIVE,),
    LIVE: (DRAFT, ENDED),
    ENDED: (LIVE,),
}

# The cards, in their default order. INTRO opens and SUMMARY closes whatever staff choose.
CARD_KEYS = (
    "INTRO",
    "MINUTES",
    "TOP_SONG",
    "TOP_SONGS",
    "TOP_ACTS",
    "FAN_RANK",
    "CLOCK",
    "MONTHS",
    "STREAK",
    "DISCOVERY",
    "COLLECTION",
    "EVENTS",
    "GIFTS",
    "SUMMARY",
)
LOOKS = ("MARQUEE", "CAROUSEL", "FAIRGROUND")
MOTIONS = ("LIVELY", "CALM", "STILL")
DITHERS = ("BAYER", "GRAIN")

# Technical limits so a page stays light; not business rules.
NAME_MAX = 80
WORDS_MAX = 140
TITLE_MAX = 80
TOP_MIN, TOP_MAX = 3, 10
CELL_MIN, CELL_MAX = 2, 8
SLIDE_MIN_S, SLIDE_MAX_S = 4, 15
PERIOD_MAX_DAYS = 731
THRESHOLD_MAX = 100_000
# Listen rows read for one person and period (a whole year of very heavy listening fits).
MAX_LISTEN_ROWS = 200_000

DEFAULT_SETTINGS: dict[str, Any] = {
    "tagline": "Your year in Corner Room",
    "intro": "Step right up. This is what you played, bought and lived on Corner Room.",
    "outro": "Thank you for listening. See you in the next one.",
    "look": "MARQUEE",
    "dither": {"style": "BAYER", "cell": 3, "motion": "LIVELY"},
    "slide_seconds": 7,
    "cards": [{"key": k, "on": True, "title": None} for k in CARD_KEYS],
    # Staff set these. 1 listen gives anyone who listened a Wrap; an act's rank shows only once it
    # has this many listeners in the period, so "top 50%" of two people never shows.
    "rules": {"min_listens": 1, "top_count": 5, "fan_rank_min_listeners": 10},
    "sharing": {"on": True, "show_name": True, "show_link": True},
}

# Fill-ins staff may use in headlines and words, replaced on the person's own page.
FILL_INS = ("{first_name}", "{name}", "{year}", "{top_song}", "{top_act}", "{minutes}")


class WrapSeason(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """One Corner Room Wrap: a period of activity, when fans may open it, and how it looks."""

    __tablename__ = "wrap_seasons"
    __table_args__ = (
        CheckConstraint("status IN ('DRAFT','LIVE','ENDED')", name="status"),
        CheckConstraint("ends_on >= starts_on", name="period"),
        CheckConstraint("closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at", name="window"),
        Index("ix_wrap_seasons_status", "status"),
        {"schema": "analytics"},
    )

    name: Mapped[str] = mapped_column(String(NAME_MAX), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=DRAFT, server_default=DRAFT)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date] = mapped_column(Date, nullable=False)
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    settings: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    went_live_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WrapSnapshot(UUIDPrimaryKeyMixin, Base):
    """One person's numbers for a Wrap, built the first time they open it."""

    __tablename__ = "wrap_snapshots"
    __table_args__ = (
        UniqueConstraint("season_id", "user_id", name="uq_wrap_snapshots_season_user"),
        {"schema": "analytics"},
    )

    season_id: Mapped[UUID] = mapped_column(ForeignKey("analytics.wrap_seasons.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id", ondelete="CASCADE"), nullable=False)
    stats: Mapped[dict] = mapped_column(JSONB, nullable=False)
    built_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class WrapCount(UUIDPrimaryKeyMixin, Base):
    """Running totals per Wrap, Dhaka day and kind. Nothing about who."""

    __tablename__ = "wrap_counts"
    __table_args__ = (
        CheckConstraint("count >= 0", name="count"),
        UniqueConstraint("season_id", "day", "kind", name="uq_wrap_counts_season_day_kind"),
        {"schema": "analytics"},
    )

    season_id: Mapped[UUID] = mapped_column(ForeignKey("analytics.wrap_seasons.id", ondelete="CASCADE"), nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


# Kinds of count. A share names where it went, from the page's own choice, never a referrer.
COUNT_KINDS = ("OPENED", "FINISHED", "SHARED_SHEET", "SHARED_SAVE", "SHARED_LINK", "PLAYED")


# --- settings --------------------------------------------------------------------------------------


def _bad(message: str) -> AppError:
    return AppError("VALIDATION_ERROR", message, 422)


def clean_words(value: Any, limit: int, what: str, *, allow_empty: bool = True) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise _bad(f"{what} must be words")
    cleaned = " ".join(value.split())
    if not cleaned:
        if allow_empty:
            return None
        raise _bad(f"{what} can't be empty")
    if len(cleaned) > limit:
        raise _bad(f"{what} can be {limit} characters at most")
    return cleaned


def _int(value: Any, low: int, high: int, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise _bad(f"{what} must be a whole number")
    if not low <= value <= high:
        raise _bad(f"{what} must be between {low} and {high}")
    return value


def merged_settings(stored: dict[str, Any] | None) -> dict[str, Any]:
    """The stored settings over the defaults, so a Wrap made before a new option still reads whole.
    Cards keep the stored order; any card added to Corner Room later joins at the end, switched off."""
    stored = stored or {}
    out: dict[str, Any] = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_SETTINGS.items()}
    for key in ("tagline", "intro", "outro", "look", "slide_seconds"):
        if key in stored:
            out[key] = stored[key]
    for key in ("dither", "rules", "sharing"):
        if isinstance(stored.get(key), dict):
            out[key] = {**DEFAULT_SETTINGS[key], **stored[key]}
    if isinstance(stored.get("cards"), list):
        seen: set[str] = set()
        cards = []
        for card in stored["cards"]:
            if isinstance(card, dict) and card.get("key") in CARD_KEYS and card["key"] not in seen:
                seen.add(card["key"])
                cards.append({"key": card["key"], "on": bool(card.get("on", True)), "title": card.get("title")})
        cards += [{"key": k, "on": False, "title": None} for k in CARD_KEYS if k not in seen]
        out["cards"] = cards
    else:
        out["cards"] = [dict(c) for c in DEFAULT_SETTINGS["cards"]]
    return out


def clean_settings(raw: dict[str, Any]) -> dict[str, Any]:
    """Check what staff sent and return the settings to store. Refuses anything out of range."""
    if not isinstance(raw, dict):
        raise _bad("Settings must be an object")
    s = merged_settings(raw)
    s["tagline"] = clean_words(s.get("tagline"), WORDS_MAX, "The tagline", allow_empty=False)
    s["intro"] = clean_words(s.get("intro"), WORDS_MAX * 2, "The opening words")
    s["outro"] = clean_words(s.get("outro"), WORDS_MAX * 2, "The closing words")
    if s.get("look") not in LOOKS:
        raise _bad("Choose one of the looks")
    s["slide_seconds"] = _int(s.get("slide_seconds"), SLIDE_MIN_S, SLIDE_MAX_S, "Seconds per card")
    d = s["dither"]
    if d.get("style") not in DITHERS:
        raise _bad("Choose a dither style")
    if d.get("motion") not in MOTIONS:
        raise _bad("Choose how much the background moves")
    s["dither"] = {"style": d["style"], "cell": _int(d.get("cell"), CELL_MIN, CELL_MAX, "Dither size"), "motion": d["motion"]}
    r = s["rules"]
    s["rules"] = {
        "min_listens": _int(r.get("min_listens"), 0, THRESHOLD_MAX, "Listens needed for a Wrap"),
        "top_count": _int(r.get("top_count"), TOP_MIN, TOP_MAX, "Songs and acts in the top lists"),
        "fan_rank_min_listeners": _int(r.get("fan_rank_min_listeners"), 1, THRESHOLD_MAX, "Listeners an act needs before ranks show"),
    }
    sh = s["sharing"]
    s["sharing"] = {k: bool(sh.get(k)) for k in ("on", "show_name", "show_link")}
    s["cards"] = [
        {"key": c["key"], "on": bool(c["on"]), "title": clean_words(c.get("title"), TITLE_MAX, "A card's headline")}
        for c in s["cards"]
    ]
    if not any(c["on"] for c in s["cards"]):
        raise _bad("Keep at least one card switched on")
    return s


def check_period(starts_on: date, ends_on: date) -> None:
    if ends_on < starts_on:
        raise _bad("The period must end on or after the day it starts")
    if (ends_on - starts_on).days + 1 > PERIOD_MAX_DAYS:
        raise _bad(f"A Wrap covers {PERIOD_MAX_DAYS} days at most")


def check_window(opens_at: datetime | None, closes_at: datetime | None) -> None:
    if opens_at and closes_at and closes_at <= opens_at:
        raise _bad("It must close after it opens")


def check_transition(current: str, target: str) -> None:
    if target not in TRANSITIONS.get(current, ()):
        raise AppError("INVALID_TRANSITION", "That can't be done at this stage", 409)


def fan_state(status: str, opens_at: datetime | None, closes_at: datetime | None, now: datetime) -> str:
    """OPEN (fans can open it), SOON (live, waiting for its opening time) or CLOSED."""
    if status != LIVE:
        return "CLOSED"
    if opens_at and now < opens_at:
        return "SOON"
    if closes_at and now >= closes_at:
        return "CLOSED"
    return "OPEN"


def dhaka_day(moment: datetime) -> date:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(DHAKA).date()


# --- the numbers -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class ListenRow:
    track_id: UUID
    act_id: UUID | None
    listened_ms: int
    day: date
    counted_at: datetime


def longest_streak(days: Iterable[date]) -> tuple[int, date | None, date | None]:
    """The longest run of days in a row with at least one listen (the first such run on a tie)."""
    ordered = sorted(set(days))
    best, best_from, best_to = 0, None, None
    run, run_from = 0, None
    prev: date | None = None
    for d in ordered:
        if prev is not None and d - prev == timedelta(days=1):
            run += 1
        else:
            run, run_from = 1, d
        if run > best:
            best, best_from, best_to = run, run_from, d
        prev = d
    return best, best_from, best_to


def hour_of(moment: datetime) -> int:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(DHAKA).hour


# Parts of the day, by Dhaka hour: the listener's "character" on the clock card.
DAY_PARTS = (
    ("EARLY_BIRD", range(5, 11)),
    ("DAYTIME", range(11, 17)),
    ("SUNDOWN", range(17, 22)),
    ("NIGHT_OWL", (*range(22, 24), *range(0, 5))),
)


def day_part(hours: list[int]) -> str | None:
    """The part of the day with the most listens, or None with none at all."""
    if not any(hours):
        return None
    totals = {name: sum(hours[h] for h in hrs) for name, hrs in DAY_PARTS}
    return max(totals, key=lambda k: totals[k])


def months_between(starts_on: date, ends_on: date) -> list[str]:
    out: list[str] = []
    y, m = starts_on.year, starts_on.month
    while (y, m) <= (ends_on.year, ends_on.month):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def summarise_listens(
    rows: list[ListenRow],
    *,
    starts_on: date,
    ends_on: date,
    top_count: int,
    first_heard: dict[UUID, date] | None = None,
) -> dict[str, Any]:
    """Everything the listening cards need from one person's counted listens in the period.
    `first_heard` is the first day the person ever heard each song (before the period too), so
    discoveries are music new to them, not just new in the period."""
    rows = [r for r in rows if starts_on <= r.day <= ends_on]
    by_song: Counter[UUID] = Counter()
    ms_by_song: Counter[UUID] = Counter()
    by_act: Counter[UUID] = Counter()
    songs_of_act: dict[UUID, set[UUID]] = defaultdict(set)
    by_day: Counter[date] = Counter()
    hours = [0] * 24
    months = dict.fromkeys(months_between(starts_on, ends_on), 0)
    first_row: ListenRow | None = None
    for r in rows:
        by_song[r.track_id] += 1
        ms_by_song[r.track_id] += max(0, r.listened_ms)
        if r.act_id:
            by_act[r.act_id] += 1
            songs_of_act[r.act_id].add(r.track_id)
        by_day[r.day] += 1
        hours[hour_of(r.counted_at)] += 1
        key = f"{r.day.year:04d}-{r.day.month:02d}"
        if key in months:
            months[key] += 1
        if first_row is None or r.counted_at < first_row.counted_at:
            first_row = r

    def ranked(counter: Counter[UUID]) -> list[tuple[UUID, int]]:
        # Most listens first; ties by more time heard, then by id so the order never shuffles.
        return sorted(counter.items(), key=lambda kv: (-kv[1], -ms_by_song.get(kv[0], 0), str(kv[0])))[:top_count]

    streak, streak_from, streak_to = longest_streak(by_day)
    busiest = max(by_day.items(), key=lambda kv: (kv[1], -kv[0].toordinal())) if by_day else None
    new_songs: set[UUID] = set()
    new_acts: set[UUID] = set()
    if first_heard is not None:
        new_songs = {t for t in by_song if starts_on <= first_heard.get(t, starts_on) <= ends_on}
        acts_heard_before = {r.act_id for r in rows if r.act_id and r.track_id not in new_songs}
        new_acts = {r.act_id for r in rows if r.act_id and r.track_id in new_songs} - acts_heard_before
    peak = max(range(24), key=lambda h: (hours[h], -h)) if rows else None
    return {
        "listens": len(rows),
        "minutes": sum(ms_by_song.values()) // 60_000,
        "songs": len(by_song),
        "acts": len(by_act),
        "top_songs": [{"track_id": t, "listens": n, "minutes": ms_by_song[t] // 60_000} for t, n in ranked(by_song)],
        "top_acts": [{"act_id": a, "listens": n, "songs": len(songs_of_act[a])} for a, n in ranked(by_act)],
        "hours": hours,
        "peak_hour": peak,
        "day_part": day_part(hours),
        "months": [{"month": k, "listens": v} for k, v in months.items()],
        "streak": {"days": streak, "from": streak_from, "to": streak_to} if streak else None,
        "busiest_day": {"day": busiest[0], "listens": busiest[1]} if busiest else None,
        "first_song": {"track_id": first_row.track_id, "day": first_row.day} if first_row else None,
        "new_songs": len(new_songs),
        "new_acts": len(new_acts),
        "new_act_ids": sorted(new_acts, key=lambda a: (-by_act[a], str(a)))[:3],
    }


def fan_rank(mine: int, others: list[int], min_listeners: int) -> dict[str, int] | None:
    """Where the person stands among everyone who heard an act in the period: rank 1 is the most
    listens. `others` holds every listener's count, the person's own included. Given only once the
    act has `min_listeners`, and only as a share (top 1% at best), never who the others are."""
    listeners = len(others)
    if mine <= 0 or listeners < max(1, min_listeners):
        return None
    rank = 1 + sum(1 for n in others if n > mine)
    return {"rank": rank, "listeners": listeners, "top_percent": max(1, math.ceil(rank * 100 / listeners))}


def has_enough(stats: dict[str, Any], min_listens: int) -> bool:
    """A Wrap needs at least `min_listens` counted listens, or any other activity when that is 0."""
    if stats.get("listens", 0) >= max(1, min_listens):
        return True
    if min_listens > 0:
        return False
    bought = stats.get("bought") or {}
    events = stats.get("events") or {}
    gifts = stats.get("gifts") or {}
    return bool(
        stats.get("listens")
        or bought.get("songs")
        or bought.get("releases")
        or events.get("tickets")
        or gifts.get("given")
        or stats.get("follows")
    )


def cards_for(settings: dict[str, Any], stats: dict[str, Any]) -> list[dict[str, Any]]:
    """The cards this person sees, in staff's order: switched on and with something real to say."""

    def has(key: str) -> bool:
        if key in ("INTRO", "SUMMARY"):
            return True
        if key == "MINUTES":
            return stats.get("listens", 0) > 0
        if key in ("TOP_SONG", "TOP_SONGS"):
            return len(stats.get("top_songs") or []) >= (1 if key == "TOP_SONG" else 2)
        if key == "TOP_ACTS":
            return len(stats.get("top_acts") or []) >= 1
        if key == "FAN_RANK":
            return bool(stats.get("fan_rank"))
        if key == "CLOCK":
            return stats.get("peak_hour") is not None
        if key == "MONTHS":
            return sum(1 for m in stats.get("months") or [] if m["listens"]) >= 2
        if key == "STREAK":
            return bool(stats.get("streak")) and stats["streak"]["days"] >= 2
        if key == "DISCOVERY":
            return (stats.get("new_songs") or 0) > 0
        if key == "COLLECTION":
            b = stats.get("bought") or {}
            return bool(b.get("songs") or b.get("releases"))
        if key == "EVENTS":
            return bool((stats.get("events") or {}).get("tickets"))
        if key == "GIFTS":
            g = stats.get("gifts") or {}
            return bool(g.get("given") or g.get("received"))
        return False

    return [{"key": c["key"], "title": c.get("title")} for c in settings["cards"] if c["on"] and has(c["key"])]


def jsonable(value: Any) -> Any:
    """Stats as JSON for the snapshot column: ids and dates as strings."""
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple | set):
        return [jsonable(v) for v in value]
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    return value
