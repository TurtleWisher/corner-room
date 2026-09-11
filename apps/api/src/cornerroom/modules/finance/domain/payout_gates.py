"""Pure payout eligibility. Thresholds and KYC rules are data, not coded rates."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from cornerroom.infra.errors import AppError


@dataclass(frozen=True, slots=True)
class PayoutConfigView:
    second_approver_threshold_minor: int | None
    minimum_threshold_minor: int | None
    schedule: str | None


@dataclass(frozen=True, slots=True)
class PayeeComplianceView:
    kyc_present: bool
    tax_record_present: bool


def require_payout_config(config: PayoutConfigView) -> None:
    if config.second_approver_threshold_minor is None:
        raise AppError(
            "PAYOUT_CONFIG_REQUIRED",
            "Payout second-approver threshold is not configured",
            409,
            "Q-P1-12 remains OPEN. Fail closed until finance_config is set.",
        )
    if config.minimum_threshold_minor is None:
        raise AppError(
            "PAYOUT_CONFIG_REQUIRED",
            "Payout minimum threshold is not configured",
            409,
            "Q-P1-12 remains OPEN. Fail closed until finance_config is set.",
        )
    if not config.schedule:
        raise AppError(
            "PAYOUT_CONFIG_REQUIRED",
            "Payout schedule is not configured",
            409,
            "Q-P1-12 remains OPEN. Fail closed until finance_config is set.",
        )


def require_minimum(amount_minor: int, config: PayoutConfigView) -> None:
    require_payout_config(config)
    assert config.minimum_threshold_minor is not None
    if amount_minor < config.minimum_threshold_minor:
        raise AppError(
            "PAYOUT_BELOW_MINIMUM",
            "Payout is below the configured minimum",
            409,
            "Minimum is config data, not a coded product threshold.",
        )


def require_compliance(compliance: PayeeComplianceView | None) -> None:
    if compliance is None or not compliance.kyc_present or not compliance.tax_record_present:
        raise AppError(
            "PAYEE_COMPLIANCE_REQUIRED",
            "Payout blocked without payee tax/KYC records",
            409,
            "Q-P0-09 / Q-P1-13. Presence is data; KYC product rules are not invented.",
        )


def requires_second_approver(amount_minor: int, config: PayoutConfigView) -> bool:
    require_payout_config(config)
    assert config.second_approver_threshold_minor is not None
    return amount_minor >= config.second_approver_threshold_minor


def assert_no_self_approve(*, actor_id: UUID, initiator_id: UUID | None) -> None:
    if initiator_id is not None and actor_id == initiator_id:
        raise AppError(
            "PAYOUT_SELF_APPROVE_FORBIDDEN",
            "The payout initiator cannot approve their own payout",
            409,
        )


def assert_distinct_second(*, actor_id: UUID, first_approver_id: UUID | None, initiator_id: UUID | None) -> None:
    if first_approver_id is not None and actor_id == first_approver_id:
        raise AppError(
            "PAYOUT_DUPLICATE_APPROVER",
            "Second approver must be a distinct user",
            409,
        )
    assert_no_self_approve(actor_id=actor_id, initiator_id=initiator_id)


def approvals_complete(
    *,
    amount_minor: int,
    config: PayoutConfigView,
    approved_by: UUID | None,
    second_approved_by: UUID | None,
) -> bool:
    if approved_by is None:
        return False
    if requires_second_approver(amount_minor, config):
        return second_approved_by is not None
    return True
