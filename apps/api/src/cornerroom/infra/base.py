"""SQLAlchemy 2 base, naming conventions, and mixins."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, MetaData, Uuid, func, text
from sqlalchemy.engine.default import DefaultDialect
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from cornerroom.kernel.ids import new_uuid

# SQLAlchemy 2.0.41+ raises before PostgreSQL can truncate names to NAMEDATALEN (63).
# Historical Alembic 0004 and the fk naming convention emit two 66-char names.
# Do not rewrite 0001–0013; let PostgreSQL truncate consistently on CREATE/DROP.
def _validate_identifier_allow_pg_truncation(self, ident: str) -> None:
    del self, ident


DefaultDialect.validate_identifier = _validate_identifier_allow_pg_truncation

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Base(DeclarativeBase):
    metadata = metadata


class UUIDPrimaryKeyMixin:
    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class ActorMixin:
    created_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    updated_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class VersionMixin:
    """Optimistic concurrency column. Apply only where contention is expected."""

    version: Mapped[int] = mapped_column(nullable=False, default=1, server_default="1")


def not_deleted() -> object:
    return text("deleted_at IS NULL")
