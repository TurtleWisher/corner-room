"""Music gifts (owner, 2026-11-06, D-GIFT-MUSIC-01): an artist or band gives chosen songs and
releases free to chosen people, by email address. No payment pages: once staff approve, each
person with an account owns the music at once (a ৳0 order, never money) and gets the act's email;
an address with no account gets the email and the music when that address becomes a verified
account (claimed the way pre-sale buyers are)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

GIFT_STATUSES = ("DRAFT", "IN_REVIEW", "SCHEDULED", "SENT")
# WAITING: not given yet (the gift isn't approved or its time hasn't come).
# GIVEN: owns the music now. WAITING_ACCOUNT: emailed; gets the music once that address is a
# verified account. ALREADY_OWNED: had all of it already (still gets the email).
RECIPIENT_STATUSES = ("WAITING", "GIVEN", "WAITING_ACCOUNT", "ALREADY_OWNED")


class MusicGift(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One gift: the music (`works`, [{"type": "RELEASE"|"TRACK", "id": "..."}]), the email that
    tells people (subject and body with fill-ins and links, as artist emails), optional files and a
    sending time. Staff approve it before anything is given or sent."""

    __tablename__ = "music_gifts"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        CheckConstraint("status IN ('DRAFT','IN_REVIEW','SCHEDULED','SENT')", name="status"),
        Index("ix_music_gifts_profile", "profile_type", "profile_id"),
        Index("ix_music_gifts_status", "organization_id", "status"),
        {"schema": "commerce"},
    )

    profile_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.organizations.id"), nullable=True)
    # The act's own name for it in Studio ("Radio friends", "Crew"); recipients never see it.
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    works: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    file_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    send_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT", server_default="DRAFT")
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(nullable=True)
    submitted_by: Mapped[UUID | None] = mapped_column(nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class MusicGiftRecipient(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One person a gift is for. Personal data: the address and the name the act typed; the act's
    team sees them because they typed them; nothing else about the account is shown to them."""

    __tablename__ = "music_gift_recipients"
    __table_args__ = (
        CheckConstraint("status IN ('WAITING','GIVEN','WAITING_ACCOUNT','ALREADY_OWNED')", name="status"),
        UniqueConstraint("gift_id", "email", name="uq_music_gift_recipients_email"),
        Index("ix_music_gift_recipients_email_status", "email", "status"),
        {"schema": "commerce"},
    )

    gift_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.music_gifts.id", ondelete="CASCADE"), nullable=False)
    # Lower-cased.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="WAITING", server_default="WAITING")
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    order_id: Mapped[UUID | None] = mapped_column(ForeignKey("commerce.orders.id"), nullable=True)
    message_id: Mapped[UUID | None] = mapped_column(nullable=True)
    given_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
