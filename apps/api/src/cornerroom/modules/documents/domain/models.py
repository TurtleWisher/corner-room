"""Thin document and media_asset tables. Production masters/IDs gated (Q-P0-12)."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
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
    # Audio platform (AUDIO_PHASE_1_DESIGN 4.2). Null on rows created before it.
    purpose: Mapped[str | None] = mapped_column(String(24), nullable=True)
    uploaded_by: Mapped[UUID | None] = mapped_column(nullable=True)
    on_behalf_profile_type: Mapped[str | None] = mapped_column(String(8), nullable=True)
    on_behalf_profile_id: Mapped[UUID | None] = mapped_column(nullable=True)
    parent_asset_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("documents.media_assets.id"), nullable=True
    )
    immutable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")


UPLOAD_PURPOSES = frozenset({"AUDIO_MASTER", "COVER_ART"})
UPLOAD_TARGET_TYPES = frozenset({"track_version", "release_cover", "event_cover"})
UPLOAD_INTENT_STATUSES = frozenset({"OPEN", "COMPLETING", "COMPLETED", "CANCELLED", "EXPIRED"})


class UploadIntent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A resumable upload of one file in parts. Owner-bound; one per media asset."""

    __tablename__ = "upload_intents"
    __table_args__ = (
        CheckConstraint("purpose IN ('AUDIO_MASTER','COVER_ART')", name="purpose"),
        CheckConstraint("target_type IN ('track_version','release_cover','event_cover')", name="target_type"),
        CheckConstraint(
            "status IN ('OPEN','COMPLETING','COMPLETED','CANCELLED','EXPIRED')", name="status"
        ),
        CheckConstraint("declared_byte_size > 0", name="declared_byte_size"),
        CheckConstraint("part_size > 0 AND part_count > 0", name="parts"),
        UniqueConstraint("media_asset_id", name="uq_upload_intents_media_asset_id"),
        Index("ix_upload_intents_status_expires", "status", "expires_at"),
        Index("ix_upload_intents_owner", "owner_user_id", "status"),
        {"schema": "documents"},
    )

    media_asset_id: Mapped[UUID] = mapped_column(ForeignKey("documents.media_assets.id"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(24), nullable=False)
    owner_user_id: Mapped[UUID] = mapped_column(nullable=False)
    target_type: Mapped[str] = mapped_column(String(24), nullable=False)
    target_id: Mapped[UUID] = mapped_column(nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    declared_byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    declared_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    part_size: Mapped[int] = mapped_column(Integer, nullable=False)
    part_count: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="OPEN")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UploadPart(Base):
    __tablename__ = "upload_parts"
    __table_args__ = (
        CheckConstraint("part_number >= 1", name="part_number"),
        CheckConstraint("byte_size > 0", name="byte_size"),
        {"schema": "documents"},
    )

    intent_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.upload_intents.id", ondelete="CASCADE"), primary_key=True
    )
    part_number: Mapped[int] = mapped_column(Integer, primary_key=True)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MediaInspection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Measured facts about one uploaded file (audio master or cover), per tool version."""

    __tablename__ = "media_inspections"
    __table_args__ = (
        UniqueConstraint("media_asset_id", "tool_version", name="uq_media_inspections_asset_tool"),
        CheckConstraint(
            "outcome IN ('ACCEPTED','ACCEPTED_WITH_WARNINGS','REJECTED')", name="outcome"
        ),
        {"schema": "documents"},
    )

    media_asset_id: Mapped[UUID] = mapped_column(ForeignKey("documents.media_assets.id"), nullable=False)
    tool: Mapped[str] = mapped_column(String(48), nullable=False)
    tool_version: Mapped[str] = mapped_column(String(64), nullable=False)
    container: Mapped[str | None] = mapped_column(String(16), nullable=True)
    codec: Mapped[str | None] = mapped_column(String(16), nullable=True)
    wav_format_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sample_rate_hz: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bit_depth: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sample_format: Mapped[str | None] = mapped_column(String(16), nullable=True)
    channels: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    integrated_lufs: Mapped[float | None] = mapped_column(Numeric(6, 2, asdecimal=False), nullable=True)
    loudness_range_lu: Mapped[float | None] = mapped_column(Numeric(6, 2, asdecimal=False), nullable=True)
    true_peak_dbtp: Mapped[float | None] = mapped_column(Numeric(6, 2, asdecimal=False), nullable=True)
    width_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height_px: Mapped[int | None] = mapped_column(Integer, nullable=True)
    verified_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    outcome: Mapped[str] = mapped_column(String(32), nullable=False)
    inspected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MediaFinding(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "media_findings"
    __table_args__ = (
        CheckConstraint("severity IN ('BLOCK','WARN')", name="severity"),
        Index("ix_media_findings_inspection", "inspection_id"),
        {"schema": "documents"},
    )

    inspection_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.media_inspections.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(48), nullable=False)
    severity: Mapped[str] = mapped_column(String(8), nullable=False)
    measured: Mapped[str | None] = mapped_column(String(64), nullable=True)
    limit_value: Mapped[str | None] = mapped_column("limit", String(64), nullable=True)


MEDIA_JOB_KINDS = frozenset({"INSPECT", "TRANSCODE"})
MEDIA_JOB_STATUSES = frozenset({"QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD", "CANCELLED"})


class MediaJob(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Durable, idempotent work on one asset. The worker claims due jobs with SKIP LOCKED."""

    __tablename__ = "media_jobs"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_media_jobs_idempotency_key"),
        CheckConstraint("kind IN ('INSPECT','TRANSCODE')", name="kind"),
        CheckConstraint(
            "status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','DEAD','CANCELLED')", name="status"
        ),
        Index("ix_media_jobs_status_next", "status", "next_attempt_at"),
        Index("ix_media_jobs_asset", "media_asset_id"),
        {"schema": "documents"},
    )

    media_asset_id: Mapped[UUID] = mapped_column(ForeignKey("documents.media_assets.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[UUID | None] = mapped_column(nullable=True)  # track version for TRANSCODE
    profile_key: Mapped[str | None] = mapped_column(String(32), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="QUEUED")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    worker_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

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
