"""Each artist's royalty rate (owner, 2026-11-28, D-ROYALTY-RATE-01).

Staff set a percentage per artist (solo or band), agreed with that artist. It is a share of what
the fan paid for that artist's music, applied to every sale: songs, releases, pre-orders and gift
purchases alike. ৳0 lines (gifts from the act, credit orders, staff test buys are never sales)
earn nothing because nothing was paid. Money a sale gave back in a refund earns nothing either.

A rate is a row with a time span. A sale takes the rate whose span holds the moment the order
was made, so a later change never touches earlier sales. Sales made while no rate covered them
show as "No rate yet"; when an admin saves a rate they may let it cover those earlier sales too,
which adds spans for the uncovered time (`covers_earlier`). The percentage itself is data the
admin types; nothing here decides one.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import ActorMixin, Base, TimestampMixin, UUIDPrimaryKeyMixin

FULL_BPS = 10_000
NOTE_MAX = 1000


class ArtistRoyaltyRate(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "artist_rates"
    __table_args__ = (
        CheckConstraint("share_bps >= 0 AND share_bps <= 10000", name="share_bps"),
        CheckConstraint(
            "effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from",
            name="range",
        ),
        Index("ix_artist_rates_artist", "artist_id", "effective_from"),
        Index(
            "uq_artist_rates_current",
            "artist_id",
            unique=True,
            postgresql_where=text("effective_to IS NULL"),
        ),
        {"schema": "royalties"},
    )

    artist_id: Mapped[UUID] = mapped_column(ForeignKey("artists.artists.id"), nullable=False)
    share_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    # None: from the very start. A sale belongs to a span when from <= made < to.
    effective_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    covers_earlier: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    note: Mapped[str | None] = mapped_column(String(NOTE_MAX), nullable=True)
    ended_by: Mapped[UUID | None] = mapped_column(nullable=True)


@dataclass(frozen=True, slots=True)
class Span:
    """A stretch of time with no rate: [start, end). None start means from the very start."""

    start: datetime | None
    end: datetime


@dataclass(frozen=True, slots=True)
class RateSpan:
    share_bps: int
    start: datetime | None
    end: datetime | None


def valid_bps(value: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= FULL_BPS


def covers(span: RateSpan, when: datetime) -> bool:
    if span.start is not None and when < span.start:
        return False
    if span.end is not None and when >= span.end:
        return False
    return True


def rate_at(spans: list[RateSpan], when: datetime) -> int | None:
    """The share in basis points for a sale made at `when`, or None when no rate covers it."""
    for span in spans:
        if covers(span, when):
            return span.share_bps
    return None


def line_refund(refunded_order_minor: int, line_minor: int, order_total_minor: int) -> int:
    """The part of an order's refunds that belongs to one line, never more than the line.

    Music orders usually carry one line; a fan's gift order carries one per person, so refunds
    are shared in proportion to each line (rounded down, integers only).
    """
    if refunded_order_minor <= 0 or line_minor <= 0:
        return 0
    if order_total_minor <= 0 or order_total_minor <= line_minor:
        return min(refunded_order_minor, line_minor)
    return min(line_minor, refunded_order_minor * line_minor // order_total_minor)


def earned_minor(paid_minor: int, refunded_minor: int, share_bps: int | None) -> int | None:
    """What the artist earns from one sale line: the share of what the fan paid and kept paid.

    Rounded down to the minor unit (integers only; never floats). None when no rate covers it.
    """
    if share_bps is None:
        return None
    kept = max(0, paid_minor - max(0, refunded_minor))
    return kept * share_bps // FULL_BPS


def uncovered_before(spans: list[RateSpan], until: datetime) -> list[Span]:
    """Stretches before `until` that no rate covers, oldest first.

    `spans` must not overlap (the service keeps it so). An open-ended span reaching `until`
    leaves nothing uncovered after its start.
    """
    ordered = sorted(spans, key=lambda s: (s.start is not None, s.start or until))
    gaps: list[Span] = []
    cursor: datetime | None = None  # None: the very start
    first = True
    for span in ordered:
        start = span.start
        if start is not None and start >= until:
            break
        if first:
            if start is not None:
                gaps.append(Span(None, start))
        elif cursor is not None and start is not None and start > cursor:
            gaps.append(Span(cursor, start))
        first = False
        if span.end is None:
            return gaps
        if cursor is None or span.end > cursor:
            cursor = span.end
    if first:
        return [Span(None, until)]
    if cursor is not None and cursor < until:
        gaps.append(Span(cursor, until))
    return gaps
