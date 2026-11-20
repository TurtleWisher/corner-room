"""Fan gifts (owner, 2026-11-20, D-GIFT-FAN-01): any signed-in fan buys a released song or release
for people they know, by email address, and pays first. The sale counts the moment the giver pays
(one paid order, one line per person, so royalties follow the music as for any sale).

After payment (and after staff check the giver's note, when there is one) each person is emailed:
- a verified account that doesn't own the music owns it at once (status GIVEN);
- an address with no account gets it when that address becomes a verified account (WAITING_ACCOUNT);
- someone who already owns it chooses (CHOOSING): keep the amount as credit for that act's music,
  pass the gift on to another email address, or decline it (the giver gets the amount back as
  credit for the same act's music).
A gift nobody claims in `fan_gift_claim_days` (7, owner) goes back to the giver as that credit.

Credit is per act and spends only on that act's music (owner): the act keeps the sale it already
counted and no money ever moves between acts. Nothing is paid back by hand (owner: credit instead of
refund). The giver never learns why a gift was declined or whether someone owned the music: before
paying nothing is checked, and afterwards the giver sees only Delivered, Accepted, Passed on,
Declined or Not claimed."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

GIFT_STATUSES = ("PENDING_PAYMENT", "WAITING_NOTE", "DELIVERED", "CANCELLED")
NOTE_STATES = ("NONE", "WAITING", "APPROVED", "REMOVED")
# WAITING: paid for (or not yet), not emailed. GIVEN: owns the music. WAITING_ACCOUNT: emailed, gets
# it once the address is a verified account. CHOOSING: owned it already, choosing what to do.
# KEPT_CREDIT, PASSED_ON, DECLINED: what the person chose. EXPIRED: not claimed in time.
RECIPIENT_STATUSES = (
    "WAITING", "GIVEN", "WAITING_ACCOUNT", "CHOOSING", "KEPT_CREDIT", "PASSED_ON", "DECLINED", "EXPIRED",
)
OPEN_STATUSES = ("WAITING_ACCOUNT", "CHOOSING")
CHOICES = ("KEEP_CREDIT", "PASS_ON", "DECLINE")
CREDIT_REASONS = ("GIFT_KEPT", "GIFT_DECLINED", "GIFT_NOT_CLAIMED", "SPENT")

NOTE_MAX = 300
NAME_MAX = 120


class FanGift(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One gift order: what was bought, for whom, and the giver's optional note."""

    __tablename__ = "fan_gifts"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING_PAYMENT','WAITING_NOTE','DELIVERED','CANCELLED')", name="status"),
        CheckConstraint("note_state IN ('NONE','WAITING','APPROVED','REMOVED')", name="note_state"),
        CheckConstraint("work_type IN ('TRACK','RELEASE')", name="work_type"),
        CheckConstraint("unit_amount_minor > 0", name="unit_amount_positive"),
        UniqueConstraint("order_id", name="uq_fan_gifts_order_id"),
        Index("ix_fan_gifts_giver", "giver_user_id"),
        Index("ix_fan_gifts_note_state", "note_state", "status"),
        {"schema": "commerce"},
    )

    giver_user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    order_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.orders.id"), nullable=False)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("identity.organizations.id"), nullable=False)
    product_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.products.id"), nullable=False)
    work_type: Mapped[str] = mapped_column(String(8), nullable=False)
    work_id: Mapped[UUID] = mapped_column(nullable=False)
    # The act the music belongs to (an artist row; every band is one too, D-ARTIST-UNIFY-01).
    act_id: Mapped[UUID] = mapped_column(nullable=False)
    unit_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    note_state: Mapped[str] = mapped_column(String(10), nullable=False, default="NONE")
    note_reviewed_by: Mapped[UUID | None] = mapped_column(nullable=True)
    note_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING_PAYMENT")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FanGiftRecipient(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One person a gift is for, tied to the order line paid for them."""

    __tablename__ = "fan_gift_recipients"
    __table_args__ = (
        CheckConstraint(
            "status IN ('WAITING','GIVEN','WAITING_ACCOUNT','CHOOSING','KEPT_CREDIT','PASSED_ON','DECLINED','EXPIRED')",
            name="status",
        ),
        UniqueConstraint("token_hash", name="uq_fan_gift_recipients_token_hash"),
        Index("ix_fan_gift_recipients_email_status", "email", "status"),
        Index("ix_fan_gift_recipients_gift", "gift_id"),
        Index("ix_fan_gift_recipients_open", "status", "expires_at"),
        {"schema": "commerce"},
    )

    gift_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.fan_gifts.id"), nullable=False)
    order_item_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.order_items.id"), nullable=False)
    # Lower-case and trimmed, the way accounts store emails. Personal data.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    name: Mapped[str | None] = mapped_column(String(NAME_MAX), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="WAITING")
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    # The gift page's link: only its hash is kept.
    token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Passed on by the person before (D-GIFT-FAN-01 pass on).
    passed_from_id: Mapped[UUID | None] = mapped_column(ForeignKey("commerce.fan_gift_recipients.id"), nullable=True)
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GiftCredit(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One movement of a person's credit for one act's music: + when a gift's amount becomes credit,
    - when it is spent. The balance is the sum. Never money paid out."""

    __tablename__ = "gift_credits"
    __table_args__ = (
        CheckConstraint("reason IN ('GIFT_KEPT','GIFT_DECLINED','GIFT_NOT_CLAIMED','SPENT')", name="reason"),
        CheckConstraint("amount_minor <> 0", name="amount_not_zero"),
        Index("ix_gift_credits_user_act", "user_id", "act_id"),
        {"schema": "commerce"},
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("identity.users.id"), nullable=False)
    act_id: Mapped[UUID] = mapped_column(nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    reason: Mapped[str] = mapped_column(String(20), nullable=False)
    fan_gift_recipient_id: Mapped[UUID | None] = mapped_column(ForeignKey("commerce.fan_gift_recipients.id"), nullable=True)
    order_id: Mapped[UUID | None] = mapped_column(ForeignKey("commerce.orders.id"), nullable=True)


# ---- pure rules -------------------------------------------------------------------------------

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def clean_people(raw: Any, *, giver_email: str | None, max_people: int) -> list[dict[str, str | None]]:
    """The people a gift is for, checked: real addresses, each once, never the giver's own, at most
    `max_people`. Raises ValueError with a code the API turns into a problem."""
    if not isinstance(raw, list) or not raw:
        raise ValueError("NO_PEOPLE")
    people: list[dict[str, str | None]] = []
    seen: set[str] = set()
    own = normalize_email(giver_email)
    for row in raw:
        row = row if isinstance(row, dict) else {"email": row}
        email = normalize_email(row.get("email"))
        if not _EMAIL.match(email) or len(email) > 320:
            raise ValueError("BAD_EMAIL")
        if own and email == own:
            raise ValueError("OWN_EMAIL")
        if email in seen:
            raise ValueError("SAME_EMAIL_TWICE")
        seen.add(email)
        name = " ".join(str(row.get("name") or "").split())[:NAME_MAX] or None
        people.append({"email": email, "name": name})
    if max_people > 0 and len(people) > max_people:
        raise ValueError("TOO_MANY_PEOPLE")
    return people


def clean_note(value: Any) -> str | None:
    text = str(value or "").replace("\r\n", "\n").strip()
    if not text:
        return None
    if len(text) > NOTE_MAX:
        raise ValueError("NOTE_TOO_LONG")
    return text


def expires_from(now: datetime, claim_days: int) -> datetime | None:
    """When an emailed gift goes back to the giver if nobody claims it. 0 days = never."""
    return now + timedelta(days=claim_days) if claim_days > 0 else None


def is_expired(status: str, expires_at: datetime | None, now: datetime) -> bool:
    return status in OPEN_STATUSES and expires_at is not None and expires_at <= now


def giver_state(status: str) -> str:
    """What the giver may see: never why, never whether the person owned the music."""
    if status == "WAITING":
        return "NOT_SENT_YET"
    if status in ("WAITING_ACCOUNT", "CHOOSING"):
        return "DELIVERED"
    if status in ("GIVEN", "KEPT_CREDIT"):
        return "ACCEPTED"
    if status == "PASSED_ON":
        return "PASSED_ON"
    if status == "DECLINED":
        return "DECLINED"
    return "NOT_CLAIMED"


def credit_back_reason(status: str) -> str | None:
    """Credit the giver gets back when a person declines or never claims."""
    return {"DECLINED": "GIFT_DECLINED", "EXPIRED": "GIFT_NOT_CLAIMED"}.get(status)


def may_choose(status: str, choice: str) -> bool:
    """Choices exist only for someone who already owned the music."""
    return status == "CHOOSING" and choice in CHOICES


def act_of(primary_artist_id: UUID | None, primary_band_id: UUID | None) -> UUID | None:
    """A work's act: its artist, or its band (every band is also an artist row)."""
    return primary_artist_id or primary_band_id
