"""PayoutProvider port. Sandbox only in Phase 11. Not a confirmed bank/PSP vendor."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class PayoutInstructionResult:
    provider: str
    provider_ref: str
    accepted: bool


class PayoutProvider(Protocol):
    name: str

    def instruct(
        self,
        *,
        payout_id: UUID,
        amount_minor: int,
        currency_code: str,
        method_token_ref: str,
    ) -> PayoutInstructionResult: ...
