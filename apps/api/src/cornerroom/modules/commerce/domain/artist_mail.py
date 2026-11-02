"""Artist emails (owner, 2026-11-02, D-MAIL-01): thank-you emails, emails to buyers, saved
templates and opt-outs. Corner Room sends every one; artists see buyers' names only (D-BUYERS-01)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

MAIL_STATUSES = ("DRAFT", "IN_REVIEW", "SENDING", "SENT")
MESSAGE_KINDS = ("THANK_YOU", "MANUAL", "TEST")
MESSAGE_STATUSES = ("PENDING", "SENT", "SUPPRESSED")


class ArtistMailSettings(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One per artist or band: whether buyers get the thank-you email and its text (null means
    Corner Room's default text). Changes go live at once (owner, 2026-11-02)."""

    __tablename__ = "artist_mail_settings"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        UniqueConstraint("profile_type", "profile_id", name="uq_artist_mail_settings_profile"),
        {"schema": "commerce"},
    )

    profile_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.organizations.id"), nullable=True)
    thank_you_on: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    thank_you_subject: Mapped[str | None] = mapped_column(String(200), nullable=True)
    thank_you_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[UUID | None] = mapped_column(nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class ArtistMailTemplate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A saved email: subject, body and audience kept together to start a new email from."""

    __tablename__ = "artist_mail_templates"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        Index("ix_artist_mail_templates_profile", "profile_type", "profile_id"),
        {"schema": "commerce"},
    )

    profile_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_by: Mapped[UUID | None] = mapped_column(nullable=True)
    updated_by: Mapped[UUID | None] = mapped_column(nullable=True)


class ArtistMail(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An email an artist or band writes to buyers. Staff approve it before anything is sent; the
    audience ({"works": [...], "who": "ALL"|"PRESALE"|"PICKED", "picked": [...]}) is worked out
    when it is approved."""

    __tablename__ = "artist_mails"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        CheckConstraint("status IN ('DRAFT','IN_REVIEW','SENDING','SENT')", name="status"),
        Index("ix_artist_mails_profile", "profile_type", "profile_id"),
        Index("ix_artist_mails_status", "organization_id", "status"),
        {"schema": "commerce"},
    )

    profile_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.organizations.id"), nullable=True)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT", server_default="DRAFT")
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(nullable=True)
    submitted_by: Mapped[UUID | None] = mapped_column(nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recipient_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class ArtistMailMessage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One email to one person, written out in full when queued. Personal data: the address is the
    account's or, for a pre-sale buyer without one, the pre-sale sheet's."""

    __tablename__ = "artist_mail_messages"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        CheckConstraint("kind IN ('THANK_YOU','MANUAL','TEST')", name="kind"),
        CheckConstraint("status IN ('PENDING','SENT','SUPPRESSED')", name="status"),
        Index("ix_artist_mail_messages_mail", "mail_id", "status"),
        Index(
            "uq_artist_mail_messages_thank_you", "profile_type", "profile_id", "order_id",
            unique=True, postgresql_where=text("kind = 'THANK_YOU'"),
        ),
        Index("uq_artist_mail_messages_stop_token", "stop_token", unique=True, postgresql_where=text("stop_token IS NOT NULL")),
        {"schema": "commerce"},
    )

    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    profile_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(nullable=False)
    mail_id: Mapped[UUID | None] = mapped_column(ForeignKey("commerce.artist_mails.id"), nullable=True)
    order_id: Mapped[UUID | None] = mapped_column(ForeignKey("commerce.orders.id"), nullable=True)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    from_name: Mapped[str] = mapped_column(String(200), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Emails to buyers carry a one-click "stop emails from this act" link; the thank-you doesn't.
    stop_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING", server_default="PENDING")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ArtistMailOptOut(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A buyer who stopped one act's emails to buyers (not the thank-you, which always sends)."""

    __tablename__ = "artist_mail_opt_outs"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        Index("uq_artist_mail_opt_outs_email", "profile_type", "profile_id", text("lower(email)"), unique=True),
        Index("ix_artist_mail_opt_outs_user", "user_id"),
        {"schema": "commerce"},
    )

    profile_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(nullable=False)
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
