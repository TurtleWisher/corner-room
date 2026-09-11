"""Thin document and media_asset tables. Production masters/IDs gated (Q-P0-12)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import (
    ActorMixin,
    Base,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class MediaAsset(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "media_assets"
    __table_args__ = {"schema": "documents"}

    storage_class: Mapped[str] = mapped_column("class", String(64), nullable=False)
    bucket: Mapped[str] = mapped_column(String(128), nullable=False)
    object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    mime: Mapped[str] = mapped_column(String(128), nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    scan_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    legal_hold: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Document(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "documents"
    __table_args__ = {"schema": "documents"}

    type: Mapped[str] = mapped_column(String(64), nullable=False)
    owner_type: Mapped[str] = mapped_column(String(64), nullable=False)
    owner_id: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="UPLOADING")
    legal_hold: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    retention_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DocumentVersion(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "document_versions"
    __table_args__ = (
        UniqueConstraint("document_id", "version", name="uq_document_versions_doc_version"),
        {"schema": "documents"},
    )

    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.documents.id"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    media_asset_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.media_assets.id"),
        nullable=False,
    )
    uploaded_by: Mapped[UUID | None] = mapped_column(nullable=True)


class DocumentAcl(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "document_acl"
    __table_args__ = {"schema": "documents"}

    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.documents.id"),
        nullable=False,
    )
    principal_type: Mapped[str] = mapped_column(String(32), nullable=False)
    principal_id: Mapped[UUID] = mapped_column(nullable=False)
    access: Mapped[str] = mapped_column(String(16), nullable=False)
