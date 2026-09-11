"""RecurringBillingPort. Not a confirmed production biller (Q-P0-03 / Q-P9)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class RecurringPeriodRequest:
    subscription_id: UUID
    plan_version_id: UUID
    amount_minor: int
    currency_code: str
    period_starts_at: datetime
    period_ends_at: datetime
    idempotency_key: str


@dataclass(frozen=True, slots=True)
class RecurringPeriodResult:
    provider: str
    accepted: bool
    next_action: str


class RecurringBillingPort(Protocol):
    name: str

    def request_period(self, request: RecurringPeriodRequest) -> RecurringPeriodResult: ...


class SandboxRecurringBilling:
    """Records intent only. Capture still goes through PaymentProvider sandbox."""

    name = "sandbox"

    def request_period(self, request: RecurringPeriodRequest) -> RecurringPeriodResult:
        del request
        return RecurringPeriodResult(
            provider=self.name,
            accepted=True,
            next_action="CREATE_ORDER_PAYMENT",
        )
