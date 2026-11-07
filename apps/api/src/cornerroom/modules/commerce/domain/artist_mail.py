"""Artist emails (owner, 2026-11-02, D-MAIL-01): thank-you emails, emails to buyers, saved
templates and opt-outs. Corner Room sends every one; artists see buyers' names only (D-BUYERS-01)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

MAIL_STATUSES = ("DRAFT", "IN_REVIEW", "SCHEDULED", "SENDING", "SENT")
MESSAGE_KINDS = ("THANK_YOU", "MANUAL", "TEST", "GIFT")
MESSAGE_STATUSES = ("PENDING", "SENT", "SUPPRESSED", "FAILED")
CLICK_KINDS = ("LINK", "LISTEN", "FILE")


class ArtistMailSettings(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One per artist or band (D-MAIL-01). Since D-MAIL-02 the thank-you emails live in
    ArtistMailThankYou; migration 0046 carried this row's text over, and it is no longer read."""

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
    occasion: Mapped[str | None] = mapped_column(String(32), nullable=True)
    file_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_by: Mapped[UUID | None] = mapped_column(nullable=True)
    updated_by: Mapped[UUID | None] = mapped_column(nullable=True)


class ArtistMailThankYou(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One thank-you email for one audience of an act (owner, 2026-11-02, D-MAIL-02): everyone or
    pre-sale buyers, of any of its music or of chosen songs and releases. On a purchase the most
    specific version that fits is sent. Changes go live at once."""

    __tablename__ = "artist_mail_thank_yous"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        Index("ix_artist_mail_thank_yous_profile", "profile_type", "profile_id"),
        {"schema": "commerce"},
    )

    profile_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.organizations.id"), nullable=True)
    audience: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    is_on: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    file_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_by: Mapped[UUID | None] = mapped_column(nullable=True)
    updated_by: Mapped[UUID | None] = mapped_column(nullable=True)


class ArtistMailFile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A soft copy an act gives buyers with an email (D-MAIL-02): a file kept by Corner Room, or a
    link to one elsewhere. Each recipient gets their own download link."""

    __tablename__ = "artist_mail_files"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        CheckConstraint("kind IN ('FILE','LINK')", name="kind"),
        Index("ix_artist_mail_files_profile", "profile_type", "profile_id"),
        {"schema": "commerce"},
    )

    profile_type: Mapped[str] = mapped_column(String(8), nullable=False)
    profile_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.organizations.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    object_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    byte_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ArtistMail(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An email an artist or band writes to buyers. Staff approve it before anything is sent; the
    audience (works, who, filters and picked people; see _clean_audience) is worked out when it
    is approved, or at send_at when it is scheduled (D-MAIL-02)."""

    __tablename__ = "artist_mails"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        CheckConstraint("status IN ('DRAFT','IN_REVIEW','SCHEDULED','SENDING','SENT')", name="status"),
        Index("ix_artist_mails_profile", "profile_type", "profile_id"),
        Index("ix_artist_mails_status", "organization_id", "status"),
        Index("ix_artist_mails_scheduled", "send_at", postgresql_where=text("status = 'SCHEDULED'")),
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
    send_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    occasion: Mapped[str | None] = mapped_column(String(32), nullable=True)
    file_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # D-PRESALE-03: the release-day email to pre-order buyers. Once approved it waits (SCHEDULED, no
    # send_at) until this release comes out, then goes like any scheduled email.
    send_with_release_id: Mapped[UUID | None] = mapped_column(ForeignKey("music.releases.id"), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class ArtistMailMessage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One email to one person, written out in full when queued. Personal data: the address is the
    account's or, for a pre-sale buyer without one, the pre-sale sheet's."""

    __tablename__ = "artist_mail_messages"
    __table_args__ = (
        CheckConstraint("profile_type IN ('artist','band')", name="profile_type"),
        CheckConstraint("kind IN ('THANK_YOU','MANUAL','TEST','GIFT','GIFT_UPDATE')", name="kind"),
        CheckConstraint("status IN ('PENDING','SENT','SUPPRESSED','FAILED')", name="status"),
        Index("ix_artist_mail_messages_mail", "mail_id", "status"),
        Index("ix_artist_mail_messages_profile", "profile_type", "profile_id", "kind"),
        Index("ix_artist_mail_messages_gift_recipient", "gift_recipient_id"),
        Index("uq_artist_mail_messages_link_token", "link_token", unique=True, postgresql_where=text("link_token IS NOT NULL")),
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
    # D-MAIL-02: the HTML copy, the links in it ({"url", "label", "kind"}, clicked through
    # /artist-mail/c/{link_token}/{position}), and send attempts so a send that keeps failing ends.
    html: Mapped[str | None] = mapped_column(Text, nullable=True)
    links: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    link_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    thank_you_id: Mapped[UUID | None] = mapped_column(nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # D-GIFT-MUSIC-01: the email that tells someone about a music gift (kind GIFT).
    music_gift_id: Mapped[UUID | None] = mapped_column(nullable=True)
    # D-CAMPAIGN-06: a gift status email (kind GIFT_UPDATE): whose gift, and which status.
    gift_recipient_id: Mapped[UUID | None] = mapped_column(nullable=True)
    gift_status: Mapped[str | None] = mapped_column(String(16), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)


class ArtistMailClick(UUIDPrimaryKeyMixin, Base):
    """One click on a link in an act's email (owner chose click counting, no open tracking,
    2026-11-02, D-MAIL-02). Counted for the act's report; who clicked is never shown."""

    __tablename__ = "artist_mail_clicks"
    __table_args__ = (
        CheckConstraint("kind IN ('LINK','LISTEN','FILE')", name="kind"),
        Index("ix_artist_mail_clicks_message", "message_id"),
        {"schema": "commerce"},
    )

    message_id: Mapped[UUID] = mapped_column(ForeignKey("commerce.artist_mail_messages.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    clicked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))


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
    message_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("commerce.artist_mail_messages.id", ondelete="SET NULL"), nullable=True
    )
