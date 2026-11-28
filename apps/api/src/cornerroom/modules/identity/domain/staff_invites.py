"""Staff accounts waiting for their person to sign in (owner, 2026-11-28, D-STAFF-ACCOUNTS-01).

An admin adds a staff or admin account by email. When that email already belongs to a verified
Corner Room account the roles are given at once and no row is kept waiting; otherwise the invite
waits here until an account with the email is verified (Continue with Google makes it verified),
and is then ACCEPTED with the roles given.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import ActorMixin, Base, TimestampMixin, UUIDPrimaryKeyMixin


class StaffInvite(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "staff_invites"
    __table_args__ = (
        CheckConstraint("level IN ('ADMIN','STAFF')", name="level"),
        CheckConstraint("status IN ('WAITING','ACCEPTED','CANCELLED')", name="status"),
        Index(
            "uq_staff_invites_waiting_email",
            "email",
            unique=True,
            postgresql_where=text("status = 'WAITING'"),
        ),
        {"schema": "identity"},
    )

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    # Role keys of the staff areas (STAFF only; an admin gets the whole portal).
    areas: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="WAITING")
    user_id: Mapped[UUID | None] = mapped_column(ForeignKey("identity.users.id"), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
