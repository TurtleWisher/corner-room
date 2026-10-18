"""Bangla QR with staff verification (Q-PAY-01 decided 2026-10-18: "both, staff first").

One static merchant QR (the owner's image, Q-PAY-03). The buyer pays in their bank or wallet app
and submits the transaction ID, the number paid from and the app; finance staff match it against
the statement and confirm or reject (`CheckoutService.submit_payment` / `confirm_submission`).
There is no provider webhook for this method, so `parse_callback` refuses everything: a payment is
captured only by a staff confirmation. A provider with signed callbacks (option b) plugs into the
same PaymentProvider port later.
"""

from __future__ import annotations

from uuid import UUID

from cornerroom.infra.errors import AppError
from cornerroom.kernel.payment import PaymentCallback, PaymentIntentResult


class BanglaQrStaffVerifiedProvider:
    name = "bangla_qr"

    def create_intent(self, *, payment_id: UUID, amount_minor: int, currency_code: str) -> PaymentIntentResult:
        del amount_minor, currency_code
        return PaymentIntentResult(provider=self.name, provider_ref=f"bqr-{payment_id.hex[-12:]}", next_status="REQUIRES_ACTION")

    def parse_callback(self, payload: dict[str, object], *, signature: str | None, secret: str) -> PaymentCallback:
        del payload, signature, secret
        raise AppError(
            "PAYMENT_CALLBACK_UNSUPPORTED",
            "Bangla QR payments are confirmed by staff, not by a callback",
            409,
        )


PAID_WITH = ("BKASH", "NAGAD", "ROCKET", "UPAY", "BANK_APP", "OTHER")
