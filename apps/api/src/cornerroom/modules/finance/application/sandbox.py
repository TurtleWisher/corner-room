"""Sandbox PaymentProvider. Not a confirmed PSP vendor (Q-P0-03)."""

from __future__ import annotations

import hashlib
import hmac
import json
from uuid import UUID

from cornerroom.infra.errors import AppError
from cornerroom.kernel.payment import PaymentCallback, PaymentIntentResult


class SandboxPaymentProvider:
    name = "sandbox"

    def create_intent(
        self,
        *,
        payment_id: UUID,
        amount_minor: int,
        currency_code: str,
    ) -> PaymentIntentResult:
        del amount_minor, currency_code
        return PaymentIntentResult(
            provider=self.name,
            provider_ref=str(payment_id),
            next_status="REQUIRES_ACTION",
        )

    def parse_callback(
        self,
        payload: dict[str, object],
        *,
        signature: str | None,
        secret: str,
    ) -> PaymentCallback:
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        expected = hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
        if not signature or not hmac.compare_digest(signature, expected):
            raise AppError("PAYMENT_SIGNATURE_INVALID", "Invalid payment callback signature", 401)
        try:
            payment_id = UUID(str(payload["payment_id"]))
            amount_minor = int(payload["amount_minor"])  # noqa: F841 - validated via Money later
            currency_code = str(payload["currency_code"]).upper()
            provider_event_id = str(payload["provider_event_id"])
            status = str(payload.get("status") or "CAPTURED").upper()
        except (KeyError, TypeError, ValueError) as exc:
            raise AppError("VALIDATION_ERROR", "Invalid payment callback", 422) from exc
        if not isinstance(payload.get("amount_minor"), int):
            raise AppError("VALIDATION_ERROR", "amount_minor must be int", 422)
        captured = status == "CAPTURED"
        return PaymentCallback(
            payment_id=payment_id,
            amount_minor=int(payload["amount_minor"]),
            currency_code=currency_code,
            provider_event_id=provider_event_id,
            captured=captured,
        )


def sign_sandbox_payload(payload: dict[str, object], secret: str) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
