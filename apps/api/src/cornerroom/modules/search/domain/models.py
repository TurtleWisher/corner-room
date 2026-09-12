"""Search projection table. Owner: Search. Rebuildable; not OLTP truth."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, Computed, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

SEARCH_TSV_SQL = (
    "to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || "
    "coalesce(subtitle, '') || ' ' || coalesce(searchable_text, ''))"
)


class SearchDocument(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """FTS document keyed by (entity_type, entity_id). Default visibility is UNAVAILABLE."""

    __tablename__ = "search_documents"
    __table_args__ = (
        CheckConstraint(
            "entity_type IN ('ARTIST','BAND','RELEASE','TRACK','EVENT','VENUE',"
            "'CAMPAIGN','USER','ORGANIZATION')",
            name="entity_type",
        ),
        CheckConstraint(
            "visibility IN ('PUBLIC','STAFF_ORG','UNAVAILABLE')",
            name="visibility",
        ),
        UniqueConstraint("entity_type", "entity_id", name="uq_search_documents_entity"),
        Index("ix_search_documents_organization_id", "organization_id"),
        Index("ix_search_documents_visibility", "visibility"),
        Index("ix_search_documents_entity_type", "entity_type"),
        Index("ix_search_documents_tsv", "tsv", postgresql_using="gin"),
        Index(
            "ix_search_documents_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
        {"schema": "search"},
    )

    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(nullable=False)
    organization_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=True,
    )
    visibility: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="UNAVAILABLE",
        server_default="UNAVAILABLE",
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(500), nullable=True)
    searchable_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tsv: Mapped[str] = mapped_column(TSVECTOR(), Computed(SEARCH_TSV_SQL, persisted=True))
    source_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    indexed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
