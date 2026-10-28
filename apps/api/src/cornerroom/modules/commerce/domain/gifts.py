"""Gift campaigns (owner, 2026-10-28, D-CAMPAIGN-01, D-CAMPAIGN-02). Free extras for buyers: no
prices and no money anywhere here."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

CAMPAIGN_STATUSES = ("DRAFT", "IN_REVIEW", "ACTIVE", "PAUSED", "ENDED")
RECIPIENT_STATUSES = ("YET_TO_SEND", "IN_PROCESS", "SENT")


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
        CheckConstraint("status IN ('YET_TO_SEND','IN_PROCESS','SENT')", name="status"),
        Index("ix_gift_recipients_campaign", "campaign_id", "status"),
        Index("uq_gift_recipients_email", "campaign_id", text("lower(email)"), unique=True),
        {"schema": "commerce"},
    )

    campaign_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.gift_campaigns.id"), nullable=False)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    order_id: Mapped[UUID | None] = mapped_column(nullable=True)
    presale_claim_id: Mapped[UUID | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="YET_TO_SEND", server_default="YET_TO_SEND")
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    dispatched_by: Mapped[UUID | None] = mapped_column(nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_by: Mapped[UUID | None] = mapped_column(nullable=True)
