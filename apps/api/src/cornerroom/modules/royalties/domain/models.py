"""Royalty tables. Owner: Royalties. Not a Finance ledger. No hardcoded rates."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from cornerroom.infra.base import ActorMixin, Base, TimestampMixin, UUIDPrimaryKeyMixin


class Rights(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "rights"
    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT','ACTIVE','DISPUTED','RETIRED')",
            name="status",
        ),
        CheckConstraint(
            "residual_payee_type IS NULL OR residual_payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="residual_payee_type",
        ),
        CheckConstraint(
            "(residual_payee_type IS NULL) = (residual_payee_id IS NULL)",
            name="residual_payee_pair",
        ),
        Index("ix_rights_track_id", "track_id"),
        Index("ix_rights_status", "status"),
        {"schema": "royalties"},
    )

    track_id: Mapped[UUID | None] = mapped_column(ForeignKey("music.tracks.id"), nullable=True)
    event_id: Mapped[UUID | None] = mapped_column(nullable=True)
    contract_id: Mapped[UUID | None] = mapped_column(nullable=True)
    territory: Mapped[str] = mapped_column(String(16), nullable=False, default="WW")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    residual_payee_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    residual_payee_id: Mapped[UUID | None] = mapped_column(nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class RightShare(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "right_shares"
    __table_args__ = (
        CheckConstraint("share_bps >= 0 AND share_bps <= 10000", name="share_bps"),
        CheckConstraint(
            "payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="payee_type",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="effective_range",
        ),
        Index("ix_right_shares_rights_type_from", "rights_id", "right_type", "effective_from"),
        Index("ix_right_shares_payee", "payee_type", "payee_id"),
        {"schema": "royalties"},
    )

    rights_id: Mapped[UUID] = mapped_column(ForeignKey("royalties.rights.id"), nullable=False)
    right_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payee_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payee_id: Mapped[UUID] = mapped_column(nullable=False)
    share_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class RoyaltyRule(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "royalty_rules"
    __table_args__ = (
        UniqueConstraint("key", "version", name="uq_royalty_rules_key_version"),
        CheckConstraint("status IN ('DRAFT','ACTIVE','SUPERSEDED')", name="status"),
        CheckConstraint('"version" >= 1', name="version_number"),
        Index("ix_royalty_rules_key_status", "key", "status"),
        {"schema": "royalties"},
    )

    key: Mapped[str] = mapped_column(String(80), nullable=False)
    version_number: Mapped[int] = mapped_column("version", Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    definition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    row_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": row_version}


class RecognizedRevenueIntake(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """Royalty-side consumption of recognized revenue. Not a ledger."""

    __tablename__ = "recognized_revenue_intakes"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_recognized_revenue_intakes_idempotency"),
        CheckConstraint("amount_minor >= 0", name="amount_minor"),
        CheckConstraint(
            "source_type IN ('STREAMING_SUB','MUSIC_PURCHASE','OTHER')",
            name="source_type",
        ),
        Index(
            "ix_recognized_revenue_period",
            "source_type",
            "period_start",
            "period_end",
            "currency_code",
        ),
        {"schema": "royalties"},
    )

    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_id: Mapped[UUID | None] = mapped_column(nullable=True)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)


class RevenuePool(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "revenue_pools"
    __table_args__ = (
        UniqueConstraint(
            "period_start",
            "period_end",
            "source_type",
            "currency_code",
            "rule_id",
            name="uq_revenue_pools_close",
        ),
        CheckConstraint("amount_minor >= 0", name="amount_minor"),
        CheckConstraint(
            "status IN ('OPEN','FROZEN','ALLOCATED','CLOSED')",
            name="status",
        ),
        CheckConstraint(
            "source_type IN ('STREAMING_SUB','MUSIC_PURCHASE','OTHER')",
            name="source_type",
        ),
        Index("ix_revenue_pools_status", "status"),
        {"schema": "royalties"},
    )

    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="OPEN")
    rule_id: Mapped[UUID] = mapped_column(ForeignKey("royalties.royalty_rules.id"), nullable=False)
    funding_intake_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("royalties.recognized_revenue_intakes.id"),
        nullable=True,
    )
    organization_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("identity.organizations.id"),
        nullable=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class Royalty(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """Calculation run. Unique successful PRIMARY run per (pool, rule version)."""

    __tablename__ = "royalties"
    __table_args__ = (
        CheckConstraint(
            "status IN ('CALCULATING','CALCULATED','APPROVED','POSTED')",
            name="status",
        ),
        CheckConstraint("run_kind IN ('PRIMARY','CORRECTION')", name="run_kind"),
        CheckConstraint("unallocated_minor >= 0", name="unallocated_minor"),
        Index(
            "uq_royalties_pool_rule_primary",
            "revenue_pool_id",
            "rule_id",
            unique=True,
            postgresql_where=text("run_kind = 'PRIMARY'"),
        ),
        Index("ix_royalties_pool_status", "revenue_pool_id", "status"),
        {"schema": "royalties"},
    )

    revenue_pool_id: Mapped[UUID] = mapped_column(
        ForeignKey("royalties.revenue_pools.id"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CALCULATING")
    rule_id: Mapped[UUID] = mapped_column(ForeignKey("royalties.royalty_rules.id"), nullable=False)
    run_kind: Mapped[str] = mapped_column(String(32), nullable=False, default="PRIMARY")
    pool_amount_minor_snapshot: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unallocated_minor: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rule_key_snapshot: Mapped[str | None] = mapped_column(String(80), nullable=True)
    rule_version_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rule_definition_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    eligibility_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    units_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class RoyaltyLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "royalty_lines"
    __table_args__ = (
        CheckConstraint("amount_minor >= 0", name="amount_minor"),
        CheckConstraint("eligible_units >= 0", name="eligible_units"),
        CheckConstraint(
            "payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="payee_type",
        ),
        Index("ix_royalty_lines_payee", "payee_type", "payee_id"),
        Index("ix_royalty_lines_track_id", "track_id"),
        Index("ix_royalty_lines_royalty_id", "royalty_id"),
        {"schema": "royalties"},
    )

    royalty_id: Mapped[UUID] = mapped_column(ForeignKey("royalties.royalties.id"), nullable=False)
    payee_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payee_id: Mapped[UUID] = mapped_column(nullable=False)
    track_id: Mapped[UUID | None] = mapped_column(ForeignKey("music.tracks.id"), nullable=True)
    rights_id: Mapped[UUID | None] = mapped_column(ForeignKey("royalties.rights.id"), nullable=True)
    right_share_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("royalties.right_shares.id"),
        nullable=True,
    )
    right_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    revenue_pool_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("royalties.revenue_pools.id"),
        nullable=True,
    )
    rule_id: Mapped[UUID | None] = mapped_column(ForeignKey("royalties.royalty_rules.id"), nullable=True)
    eligible_units: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    share_bps_snapshot: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    is_residual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class RoyaltyStatement(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "royalty_statements"
    __table_args__ = (
        UniqueConstraint(
            "payee_type",
            "payee_id",
            "period_start",
            "period_end",
            "version_number",
            name="uq_royalty_statements_payee_period_version",
        ),
        CheckConstraint(
            "status IN ('DRAFT','ISSUED','ACKNOWLEDGED','DISPUTED')",
            name="status",
        ),
        CheckConstraint(
            "payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="payee_type",
        ),
        Index("ix_royalty_statements_payee", "payee_type", "payee_id", "status"),
        {"schema": "royalties"},
    )

    payee_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payee_id: Mapped[UUID] = mapped_column(nullable=False)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    document_id: Mapped[UUID | None] = mapped_column(nullable=True)
    total_amount_minor: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    royalty_id: Mapped[UUID | None] = mapped_column(ForeignKey("royalties.royalties.id"), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class RoyaltyAdjustment(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    __tablename__ = "royalty_adjustments"
    __table_args__ = (
        CheckConstraint("status IN ('POSTED')", name="status"),
        CheckConstraint(
            "payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="payee_type",
        ),
        Index("ix_royalty_adjustments_statement_id", "statement_id"),
        {"schema": "royalties"},
    )

    statement_id: Mapped[UUID] = mapped_column(
        ForeignKey("royalties.royalty_statements.id"),
        nullable=False,
    )
    payee_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payee_id: Mapped[UUID] = mapped_column(nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    reason: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="POSTED")
    royalty_line_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("royalties.royalty_lines.id"),
        nullable=True,
    )


class Settlement(UUIDPrimaryKeyMixin, TimestampMixin, ActorMixin, Base):
    """Obligation calculation handed to Finance. Not a payout."""

    __tablename__ = "settlements"
    __table_args__ = (
        CheckConstraint("kind IN ('ROYALTY','EVENT_PARTNER','VENUE','OTHER')", name="kind"),
        CheckConstraint(
            "status IN ('CALCULATED','APPROVED','PROCESSING','PAID','COMPLETED','FAILED','VOIDED')",
            name="status",
        ),
        CheckConstraint(
            "payee_type IN ('ARTIST','USER','ORGANIZATION')",
            name="payee_type",
        ),
        CheckConstraint("amount_minor >= 0", name="amount_minor"),
        Index("ix_settlements_payee_status", "payee_type", "payee_id", "status"),
        {"schema": "royalties"},
    )

    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="ROYALTY")
    payee_type: Mapped[str] = mapped_column(String(32), nullable=False)
    payee_id: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CALCULATED")
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency_code: Mapped[str] = mapped_column(String(3), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    __mapper_args__ = {"version_id_col": version}


class SettlementLine(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "settlement_lines"
    __table_args__ = (
        Index("ix_settlement_lines_settlement_id", "settlement_id"),
        {"schema": "royalties"},
    )

    settlement_id: Mapped[UUID] = mapped_column(
        ForeignKey("royalties.settlements.id"),
        nullable=False,
    )
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_id: Mapped[UUID] = mapped_column(nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
