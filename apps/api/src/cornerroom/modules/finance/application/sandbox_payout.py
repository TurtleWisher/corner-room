"""SANDBOX payout adapter. Not a production bank or PSP vendor."""

from __future__ import annotations

from uuid import UUID

from cornerroom.kernel.payout import PayoutInstructionResult


class SandboxPayoutProvider:
    name = "SANDBOX"

    def instruct(
        self,
        *,
        payout_id: UUID,
        amount_minor: int,
        currency_code: str,
        method_token_ref: str,
    ) -> PayoutInstructionResult:
        del amount_minor, currency_code, method_token_ref
        return PayoutInstructionResult(
            provider=self.name,
            provider_ref=f"SANDBOX:{payout_id}",
            accepted=True,
        )
