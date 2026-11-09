"""Gift campaigns (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02). Free extras for buyers: no
prices and no money anywhere here."""

from __future__ import annotations

import re
from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

CAMPAIGN_STATUSES = ("DRAFT", "IN_REVIEW", "ACTIVE", "PAUSED", "ENDED")
# Collectible tracking (owner, 2026-11-06, D-CAMPAIGN-03). YET_TO_SEND is "not prepared yet".
RECIPIENT_STATUSES = ("YET_TO_SEND", "PREPARED", "DISPATCHED", "RECEIVED", "RETURNED", "MISSING")

# Where each gift may go next. Prepared can go back to not prepared; a dispatched gift ends as
# received, returned or missing; a returned gift is prepared again to send it again; a missing one
# may still turn up (received) or be prepared again. Received is the end.
RECIPIENT_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "YET_TO_SEND": ("PREPARED",),
    "PREPARED": ("YET_TO_SEND", "DISPATCHED"),
    "DISPATCHED": ("RECEIVED", "RETURNED", "MISSING"),
    "RETURNED": ("PREPARED",),
    "MISSING": ("RECEIVED", "PREPARED"),
    "RECEIVED": (),
}
# Moves that end a delivery, stamped as the gift's outcome.
OUTCOMES = ("RECEIVED", "RETURNED", "MISSING")


#: Most people added to a campaign in one go (a technical limit, not a business rule).
MAX_PEOPLE_PER_ADD = 2000
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


def phone_key(phone: str | None) -> str | None:
    """A phone number as digits only, for spotting the same person twice ("+880 1712-345678" and
    "8801712345678" match; a leading 0 after the country code is kept as written)."""
    digits = re.sub(r"\D", "", phone or "")
    return digits or None


def clean_person(raw: dict) -> tuple[dict | None, str | None]:
    """One person to add by hand (D-CAMPAIGN-04): a name, an email and/or a phone (one is required),
    and an address. Returns the cleaned person, or None and the reason it can't be added."""
    def line(value: object, limit: int) -> str | None:
        text_ = " ".join(str(value or "").split())
        return text_[:limit] or None

    email = (str(raw.get("email") or "").strip().lower()) or None
    phone = line(raw.get("phone"), 40)
    name = line(raw.get("name"), 200)
    address = str(raw.get("address") or "").replace("\r\n", "\n").strip()[:1000] or None
    if email is not None and (len(email) > 320 or not _EMAIL.match(email)):
        return None, f"{email[:80]} isn't an email address"
    if phone is not None and len(phone_key(phone) or "") < 6:
        return None, f"{phone} isn't a phone number"
    if email is None and phone is None:
        return None, f"{name or 'Someone'} needs an email or a phone"
    return {"name": name, "email": email, "phone": phone, "address": address}, None


def can_move(current: str, target: str) -> bool:
    """Whether a gift in `current` may be moved to `target`."""
    return target in RECIPIENT_TRANSITIONS.get(current, ())


class GiftCampaign(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An artist's or band's gift for buyers of some of their music. `works` lists what it covers
    ([{"type": "RELEASE"|"TRACK", "id": "..."}]). Publishing and every later change wait for staff:
    a change to a live campaign waits in `pending` and only applies once approved."""

    __tablename__ = "gift_campaigns"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        CheckConstraint("sender IN ('ARTIST','CORNER_ROOM')", name="sender"),
        CheckConstraint("status IN ('DRAFT','IN_REVIEW','ACTIVE','PAUSED','ENDED')", name="status"),
        Index("ix_gift_campaigns_profile", "profile_type", "profile_id"),
        Index("ix_gift_campaigns_status", "organization_id", "status"),
        {"schema": "commerce"},
    )

    profile_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.organizations.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    gift_items: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Who packs and posts: the artist or band, or Corner Room's team.
    sender: Mapped[str] = mapped_column(String(16), nullable=False, default="ARTIST", server_default="ARTIST")
    # Pre-sale buyers of the covered music count whatever the date (owner: the pre-sale is a campaign).
    include_presale: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Purchases from this moment count once the campaign goes live (default: when it goes live).
    counts_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    works: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT", server_default="DRAFT")
    pending: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    pending_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pending_by: Mapped[UUID | None] = mapped_column(nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(nullable=True)
    submitted_by: Mapped[UUID | None] = mapped_column(nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class GiftCampaignPeriod(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A stretch of time the campaign was live; purchases inside one count. Pausing ends one."""

    __tablename__ = "gift_campaign_periods"
    __table_args__ = (Index("ix_gift_campaign_periods_campaign", "campaign_id"), {"schema": "commerce"})

    campaign_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.gift_campaigns.id"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GiftRecipient(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One buyer owed this campaign's gift, and how far it has got. Personal data: the account or,
    for a pre-sale buyer without one, the email on the pre-sale sheet."""

    __tablename__ = "gift_recipients"
    __table_args__ = (
        CheckConstraint(
            "status IN ('YET_TO_SEND','PREPARED','DISPATCHED','RECEIVED','RETURNED','MISSING')", name="status"
        ),
        Index("ix_gift_recipients_campaign", "campaign_id", "status"),
        Index(
            "ix_gift_recipients_dispatch_due", "dispatch_at",
            postgresql_where=text("status = 'PREPARED' AND dispatch_at IS NOT NULL"),
        ),
        Index("uq_gift_recipients_email", "campaign_id", text("lower(email)"), unique=True),
        CheckConstraint("source IN ('BUYER','ADDED')", name="source"),
        CheckConstraint("email IS NOT NULL OR phone IS NOT NULL", name="reachable"),
        {"schema": "commerce"},
    )

    campaign_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.gift_campaigns.id"), nullable=False)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    # Optional since D-CAMPAIGN-04: someone added by hand may only have a phone.
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # D-CAMPAIGN-04 (owner, 2026-11-07): BUYER (found on Corner Room or the pre-sale list) or ADDED
    # (typed in or pasted from a sheet, with their own name, phone and address). An addition by the
    # act's team waits for staff (`waiting`) and counts for nothing until approved.
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="BUYER", server_default="BUYER")
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    added_by: Mapped[UUID | None] = mapped_column(nullable=True)
    waiting: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    approved_by: Mapped[UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    order_id: Mapped[UUID | None] = mapped_column(nullable=True)
    presale_claim_id: Mapped[UUID | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="YET_TO_SEND", server_default="YET_TO_SEND")
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dispatched_by: Mapped[UUID | None] = mapped_column(nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_by: Mapped[UUID | None] = mapped_column(nullable=True)
    # D-CAMPAIGN-03: when it was prepared, when it is set to leave (a prepared gift with a time is
    # dispatched by the worker when it comes), and how its delivery ended.
    prepared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    prepared_by: Mapped[UUID | None] = mapped_column(nullable=True)
    dispatch_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dispatch_set_by: Mapped[UUID | None] = mapped_column(nullable=True)
    outcome_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome_by: Mapped[UUID | None] = mapped_column(nullable=True)


# The statuses that email the buyer, and so the ones an act may word itself (owner, 2026-11-07,
# D-CAMPAIGN-05). Prepared and received don't email anyone.
STATUS_MAIL_STATUSES = ("DISPATCHED", "RETURNED", "MISSING")
STATUS_MAIL_STATES = ("DRAFT", "IN_REVIEW", "APPROVED", "RETURNED")


class GiftStatusMail(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An act's own email for one collectible status of one campaign (D-CAMPAIGN-05). `subject` and
    `body` are the words being written; `live_subject`/`live_body` are the approved words that send.
    Without live words, Corner Room's own wording sends."""

    __tablename__ = "gift_status_mails"
    __table_args__ = (
        CheckConstraint("status IN ('DISPATCHED','RETURNED','MISSING')", name="status"),
        CheckConstraint("state IN ('DRAFT','IN_REVIEW','APPROVED','RETURNED')", name="state"),
        UniqueConstraint("campaign_id", "status", name="uq_gift_status_mails_campaign_status"),
        Index("ix_gift_status_mails_state", "state"),
        {"schema": "commerce"},
    )

    campaign_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.gift_campaigns.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT", server_default="DRAFT")
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    live_subject: Mapped[str | None] = mapped_column(String(200), nullable=True)
    live_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # D-CAMPAIGN-06: a button (its words and link) and files for the gift, written and approved.
    button_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    button_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    file_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    live_button_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    live_button_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    live_file_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    sent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_by: Mapped[UUID | None] = mapped_column(nullable=True)
    updated_by: Mapped[UUID | None] = mapped_column(nullable=True)
    submitted_by: Mapped[UUID | None] = mapped_column(nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# What a one-off email to picked buyers is about (D-CAMPAIGN-07): a status, or any other gift news.
SEND_PURPOSES = ("DISPATCHED", "RETURNED", "MISSING", "OTHER")
SEND_STATES = ("IN_REVIEW", "RETURNED", "APPROVED", "SENT")


class GiftMailSend(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One email to buyers the act picked by hand, about one gift campaign (owner, 2026-11-09,
    D-CAMPAIGN-07). The words and the people go to staff together as one request; nothing reaches a
    buyer until staff approve it and then someone presses Send. Staff's own requests are approved
    and sent at once. For a status purpose, only buyers whose gift is still in that status get it."""

    __tablename__ = "gift_mail_sends"
    __table_args__ = (
        CheckConstraint("purpose IN ('DISPATCHED','RETURNED','MISSING','OTHER')", name="purpose"),
        CheckConstraint("state IN ('IN_REVIEW','RETURNED','APPROVED','SENT')", name="state"),
        Index("ix_gift_mail_sends_campaign", "campaign_id"),
        Index("ix_gift_mail_sends_state", "state"),
        {"schema": "commerce"},
    )

    campaign_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.gift_campaigns.id", ondelete="CASCADE"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    button_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    button_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    file_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    recipient_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb"))
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="IN_REVIEW", server_default="IN_REVIEW")
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(nullable=True)
    updated_by: Mapped[UUID | None] = mapped_column(nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_by: Mapped[UUID | None] = mapped_column(nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
