"""PaymentProvider port. Vendor is not confirmed (Q-P0-03)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class PaymentIntentResult:
    provider: str
    provider_ref: str
    next_status: str


@dataclass(frozen=True, slots=True)
class PaymentCallback:
    payment_id: UUID
    amount_minor: int
    currency_code: str
    provider_event_id: str
    captured: bool


class PaymentProvider(Protocol):
    name: str

    def create_intent(
        self,
        *,
        payment_id: UUID,
        amount_minor: int,
        currency_code: str,
    ) -> PaymentIntentResult: ...

    def parse_callback(self, payload: dict[str, object], *, signature: str | None, secret: str) -> PaymentCallback: ...
