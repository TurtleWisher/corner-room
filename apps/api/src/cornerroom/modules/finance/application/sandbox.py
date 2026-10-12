"""Sandbox PaymentProvider. Not a confirmed PSP vendor (Q-P0-03)."""

from __future__ import annotations

import hashlib
import hmac
import json
from uuid import UUID

from cornerroom.infra.errors import AppError
from cornerroom.kernel.payment import PaymentCallback, PaymentIntentResult


def resolve_webhook_secret(*, payment_secret: str | None, jwt_secret: str) -> str:
    """Dedicated HMAC key. Never fall back to JWT_SECRET (Gate 1 H3). No timestamp window (Q-P15-02)."""
    secret = (payment_secret or "").strip()
    if not secret:
        raise AppError(
            "PAYMENT_WEBHOOK_SECRET_REQUIRED",
            "Payment webhook secret is not configured",
            503,
            "sandbox_payment_secret must be set and must not equal JWT_SECRET",
        )
    if secret == jwt_secret:
        raise AppError(
            "PAYMENT_WEBHOOK_SECRET_REUSED",
            "Payment webhook secret must not equal JWT_SECRET",
            503,
            "Compromise of the JWT key must not forge payment callbacks",
        )
    return secret


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
