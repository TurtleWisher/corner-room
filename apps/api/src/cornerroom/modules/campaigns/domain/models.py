"""Campaigns tables. Owner: Campaigns. Budget is a planning cap, not a journal."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import (
    ActorMixin,
    Base,
    SoftDeleteMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Campaign(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "campaigns"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PLANNING','CONTENT_PREPARATION','SCHEDULED','ACTIVE',"
            "'OPTIMIZATION','COMPLETED','REPORTING','CANCELLED')",
            name="status",
        ),
        CheckConstraint(
            "ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at",
            name="ends_after_starts",
        ),
        CheckConstraint(
            "(budget_amount_minor IS NULL AND currency_code IS NULL) OR "
            "(budget_amount_minor IS NOT NULL AND currency_code IS NOT NULL)",
            name="budget_pair",
        ),
        CheckConstraint(
            "budget_amount_minor IS NULL OR budget_amount_minor >= 0",
            name="budget_non_negative",
        ),
        Index("ix_campaigns_organization_id", "organization_id"),
        Index("ix_campaigns_status", "status"),
        {"schema": "campaigns"},
    )

    organization_id: Mapped[UUID] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PLANNING")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    budget_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency_code: Mapped[str | None] = mapped_column(String(3), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class CampaignTask(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "campaign_tasks"
    __table_args__ = (
        CheckConstraint(
            "status IN ('TODO','IN_PROGRESS','BLOCKED','DONE','CANCELLED')",
            name="status",
        ),
        Index("ix_campaign_tasks_campaign_id", "campaign_id"),
        Index("ix_campaign_tasks_assignee_user_id", "assignee_user_id"),
        {"schema": "campaigns"},
    )

    campaign_id: Mapped[UUID] = mapped_column(
        ForeignKey("campaigns.campaigns.id"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="TODO")
    assignee_user_id: Mapped[UUID | None] = mapped_column(nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class CampaignLink(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "campaign_links"
    __table_args__ = (
        CheckConstraint(
            "subject_type IN ('ARTIST','RELEASE','EVENT')",
            name="subject_type",
        ),
        Index("ix_campaign_links_campaign_id", "campaign_id"),
        Index(
            "uq_campaign_links_active_subject",
            "campaign_id",
            "subject_type",
            "subject_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        {"schema": "campaigns"},
    )

    campaign_id: Mapped[UUID] = mapped_column(
        ForeignKey("campaigns.campaigns.id"),
        nullable=False,
    )
    subject_type: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_id: Mapped[UUID] = mapped_column(nullable=False)


class CampaignAsset(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "campaign_assets"
    __table_args__ = (
        Index("ix_campaign_assets_campaign_id", "campaign_id"),
        Index(
            "uq_campaign_assets_active_media",
            "campaign_id",
            "media_asset_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        {"schema": "campaigns"},
    )

    campaign_id: Mapped[UUID] = mapped_column(
        ForeignKey("campaigns.campaigns.id"),
        nullable=False,
    )
    media_asset_id: Mapped[UUID] = mapped_column(
        ForeignKey("documents.media_assets.id"),
        nullable=False,
    )


class CampaignChannel(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    __tablename__ = "campaign_channels"
    __table_args__ = (
        CheckConstraint(
            "code IN ('IN_APP','EMAIL','SOCIAL','PRESS','OTHER')",
            name="code",
        ),
        Index("ix_campaign_channels_campaign_id", "campaign_id"),
        Index(
            "uq_campaign_channels_active_code",
            "campaign_id",
            "code",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        {"schema": "campaigns"},
    )

    campaign_id: Mapped[UUID] = mapped_column(
        ForeignKey("campaigns.campaigns.id"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(32), nullable=False)


class CampaignKpiTarget(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, SoftDeleteMixin, Base):
    """Planning target only. No actuals, lift, CAC, or ROAS."""

    __tablename__ = "campaign_kpi_targets"
    __table_args__ = (
        Index("ix_campaign_kpi_targets_campaign_id", "campaign_id"),
        {"schema": "campaigns"},
    )

    campaign_id: Mapped[UUID] = mapped_column(
        ForeignKey("campaigns.campaigns.id"),
        nullable=False,
    )
    metric_key: Mapped[str] = mapped_column(String(64), nullable=False)
    target_value: Mapped[int] = mapped_column(BigInteger, nullable=False)
