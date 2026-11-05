"""Pre-sale campaigns (owner, 2026-11-06, D-PRESALE-04): the artist's own view of a pre-sale,
from setup to release day, with live numbers that carry on into the release afterwards.

What is counted here is only what the server can see for itself, and only as running totals per
hour: pages opened and Pre-book presses, where on Corner Room they happened, which of the
artist's share links brought the visit, and the name of the site a visit came from (host only,
never the page). No single visit is stored: no address, cookie, account or device. Orders,
buyers, refunds and money are read from the orders themselves, never from these counters.

Pure rules live here; `application/presale_campaigns.py` reads and writes.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

# What a count is: a page opened, or the Pre-book (or Buy, after release) button pressed.
COUNT_KINDS = ("VIEW", "PREBOOK")
# Where on Corner Room it happened. "PAGE" is the release's own page.
PLACES = ("PAGE", "STORE", "HOME", "RELEASES", "PROFILE")
# Whether the release was on pre-sale or already out when it was counted.
PHASES = ("PRESALE", "RELEASED")

SHARE_LABEL_MAX = 60
SHARE_LINKS_MAX = 20
SHARE_CODE_LENGTH = 8
_CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"  # no 0/o or 1/l, so a code read aloud survives
_CODE_RE = re.compile(r"^[a-z0-9]{4,16}$")
_HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")
# Crawlers, link previews and tools: never counted as people opening the page.
_BOT_RE = re.compile(
    r"bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp|telegram|"
    r"vkshare|pinterest|headless|lighthouse|python-|curl/|wget/|httpclient|okhttp|go-http|axios|node-fetch",
    re.IGNORECASE,
)

# Bangladesh has no daylight saving: Dhaka is always UTC+6. Days in the timeline are Dhaka days.
DHAKA = timezone(timedelta(hours=6), "Dhaka")


class PresaleCount(UUIDPrimaryKeyMixin, Base):
    """A running total for one release, one hour and one kind of count, split by place, share
    link and referring site. Empty strings stand for "not given" so the totals stay unique."""

    __tablename__ = "presale_counts"
    __table_args__ = (
        CheckConstraint("kind IN ('VIEW','PREBOOK')", name="kind"),
        CheckConstraint("phase IN ('PRESALE','RELEASED')", name="phase"),
        CheckConstraint("place IN ('','PAGE','STORE','HOME','RELEASES','PROFILE')", name="place"),
        CheckConstraint("total >= 0", name="total_non_negative"),
        UniqueConstraint("release_id", "hour", "phase", "kind", "place", "link_code", "referrer_host", name="uq_presale_counts_bucket"),
        Index("ix_presale_counts_release_hour", "release_id", "hour"),
        {"schema": "commerce"},
    )

    release_id: Mapped[UUID] = mapped_column(ForeignKey("music.releases.id"), nullable=False)
    hour: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    phase: Mapped[str] = mapped_column(String(10), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    place: Mapped[str] = mapped_column(String(10), nullable=False, default="", server_default="")
    link_code: Mapped[str] = mapped_column(String(16), nullable=False, default="", server_default="")
    referrer_host: Mapped[str] = mapped_column(String(80), nullable=False, default="", server_default="")
    total: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")


class PresaleShareLink(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A link the artist made to share the pre-sale, e.g. "Instagram bio". Visits and Pre-book
    presses that arrive through it are counted against its code; nothing else is credited to it
    (owner, 2026-11-06: no pre-order attribution)."""

    __tablename__ = "presale_share_links"
    __table_args__ = (
        UniqueConstraint("code", name="uq_presale_share_links_code"),
        Index("ix_presale_share_links_release", "release_id"),
        {"schema": "commerce"},
    )

    release_id: Mapped[UUID] = mapped_column(ForeignKey("music.releases.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(16), nullable=False)
    label: Mapped[str] = mapped_column(String(SHARE_LABEL_MAX), nullable=False)
    created_by: Mapped[UUID] = mapped_column(nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# --- pure rules -----------------------------------------------------------------------------------


def new_share_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(SHARE_CODE_LENGTH))


def clean_code(value: Any) -> str:
    """A share code from the address bar, or "" when it isn't one."""
    text = str(value or "").strip().lower()
    return text if _CODE_RE.match(text) else ""


def clean_place(value: Any) -> str:
    text = str(value or "").strip().upper()
    return text if text in PLACES else ""


def clean_label(value: Any) -> str | None:
    text = " ".join(str(value or "").split())
    return text[:SHARE_LABEL_MAX] or None


def referrer_host(value: Any, own_hosts: tuple[str, ...] = ()) -> str:
    """The site a visit came from, as its host name only ("facebook.com"), or "" for none, for
    Corner Room itself, or for anything that isn't a plain host. Never the page or its query."""
    text = str(value or "").strip().lower()
    if "://" in text:
        text = text.split("://", 1)[1]
    text = text.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0].split("@")[-1].split(":", 1)[0]
    if text.startswith("www."):
        text = text[4:]
    for prefix in ("m.", "l.", "lm."):  # facebook's mobile and link-shim hosts read as the site
        if text.startswith(prefix) and text.count(".") >= 2:
            text = text[len(prefix):]
    if not text or len(text) > 80 or not _HOST_RE.match(text):
        return ""
    for own in own_hosts:
        own = own.lower().removeprefix("www.")
        if own and (text == own or text.endswith("." + own)):
            return ""
    return text


def looks_like_bot(user_agent: str | None) -> bool:
    return not user_agent or bool(_BOT_RE.search(user_agent))


def hour_of(moment: datetime) -> datetime:
    return moment.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def dhaka_day(moment: datetime) -> str:
    return moment.astimezone(DHAKA).date().isoformat()


def conversion_bps(orders: int, views: int) -> int | None:
    """Pre-orders per page opened, in basis points (1 % = 100). None when nothing was opened:
    the screen then says "Not available", never 0."""
    if views <= 0:
        return None
    return round(orders * 10_000 / views)


def campaign_state(release: Any, *, listed: bool, open_now: bool, has_price: bool, has_orders: bool) -> str:
    """One word for where a pre-sale campaign is, for the artist's list.

    DRAFT: a pre-sale price is proposed but the pre-sale hasn't been sent; IN_REVIEW; RETURNED
    (staff sent it back); APPROVED (staff said yes, the price is still being agreed); LIVE (fans can pre-book); WAITING (the date passed, the music is being
    finished, the page stays up without the button); RELEASED (it moved to the release); ENDED
    (cancelled or withdrawn after it had been public, with nothing to show fans now)."""
    if release.status == "RELEASED":
        return "RELEASED"
    if listed and open_now:
        return "LIVE"
    if listed:
        return "WAITING"
    status = getattr(release, "presale_status", None)
    if status == "REQUESTED":
        return "IN_REVIEW"
    if status == "RETURNED":
        return "RETURNED"
    if status == "APPROVED" and has_price:
        return "APPROVED"
    if has_orders:
        return "ENDED"
    return "DRAFT"
