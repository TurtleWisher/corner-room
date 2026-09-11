"""Events tables. Owner: Events module. No ticket inventory or ledger columns."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import (
    ActorMixin,
    Base,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)

class Venue(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "venues"
    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT','ACTIVE','INACTIVE')",
            name="status",
        ),
        CheckConstraint("capacity >= 0", name="capacity_non_negative"),
        Index("ix_venues_organization_id", "organization_id"),
        Index("ix_venues_status", "status"),
        {"schema": "events"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class Event(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT','PLANNED','PUBLISHED','TICKETING_OPEN','SALES_CLOSED',"
            "'LIVE','COMPLETED','SETTLED','ARCHIVED','CANCELLED','POSTPONED')",
            name="status",
        ),
        CheckConstraint(
            "ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at",
            name="ends_after_starts",
        ),
        Index("ix_events_organization_id", "organization_id"),
        Index("ix_events_status", "status"),
        Index("ix_events_starts_at", "starts_at"),
        Index("ix_events_venue_id", "venue_id"),
        {"schema": "events"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    venue_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("events.venues.id"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    postponed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    postponement_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    previous_starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    previous_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resume_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class VenueBooking(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "venue_bookings"
    __table_args__ = (
        CheckConstraint(
            "status IN ('INQUIRED','HOLD','CONFIRMED','CANCELLED','COMPLETED')",
            name="status",
        ),
        CheckConstraint("ends_at > starts_at", name="booking_ends_after_starts"),
        Index("ix_venue_bookings_venue_range", "venue_id", "starts_at", "ends_at"),
        Index("ix_venue_bookings_event_id", "event_id"),
        Index(
            "uq_venue_bookings_active_event",
            "event_id",
            unique=True,
            postgresql_where=text("status = 'CONFIRMED' AND deleted_at IS NULL AND event_id IS NOT NULL"),
        ),
        {"schema": "events"},
    )

    venue_id: Mapped[UUID] = mapped_column(ForeignKey("events.venues.id"), nullable=False)
    event_id: Mapped[UUID | None] = mapped_column(ForeignKey("events.events.id"), nullable=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CONFIRMED")
    quoted_amount_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency_code: Mapped[str | None] = mapped_column(String(3), nullable=True)


class EventLineup(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    """Event ↔ Artist/Band participation. No fees, tickets, or contract terms."""

    __tablename__ = "event_lineups"
    __table_args__ = (
        CheckConstraint(
            "status IN ('INVITED','CONFIRMED','PERFORMED','WITHDRAWN','NO_SHOW')",
            name="status",
        ),
        CheckConstraint(
            "(artist_id IS NOT NULL AND band_id IS NULL) OR (artist_id IS NULL AND band_id IS NOT NULL)",
            name="lineup_party",
        ),
        Index("ix_event_lineups_event_id", "event_id"),
        Index("ix_event_lineups_artist_id", "artist_id"),
        Index("ix_event_lineups_band_id", "band_id"),
        Index(
            "uq_event_lineups_active_artist",
            "event_id",
            "artist_id",
            unique=True,
            postgresql_where=text(
                "artist_id IS NOT NULL AND status IN ('INVITED','CONFIRMED') AND deleted_at IS NULL"
            ),
        ),
        Index(
            "uq_event_lineups_active_band",
            "event_id",
            "band_id",
            unique=True,
            postgresql_where=text(
                "band_id IS NOT NULL AND status IN ('INVITED','CONFIRMED') AND deleted_at IS NULL"
            ),
        ),
        {"schema": "events"},
    )

    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.events.id"), nullable=False)
    artist_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("artists.artists.id"),
        nullable=True,
    )
    band_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("artists.bands.id"),
        nullable=True,
    )
    billing_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="INVITED")
    contract_id: Mapped[UUID | None] = mapped_column(nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class EventMilestone(UUIDPrimaryKeyMixin, Base):
    """Append-only curated timeline. Complements AuditLog. Not a second audit system."""

    __tablename__ = "event_milestones"
    __table_args__ = (
        Index("ix_event_milestones_event_id", "event_id"),
        {"schema": "events"},
    )

    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.events.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_id: Mapped[UUID | None] = mapped_column(nullable=True)
    previous_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    new_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
