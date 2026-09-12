"""Analytics calendar, property sanitization, and fail-closed metric stubs.

metric_date uses ASSUMED Asia/Dhaka (09_ §2). Not a product-owner timezone decision.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from cornerroom.modules.campaigns.domain.lifecycle import ATTRIBUTION_UNDEFINED

ASSUMED_METRIC_TIMEZONE = "Asia/Dhaka"
DHAKA = ZoneInfo(ASSUMED_METRIC_TIMEZONE)
METRIC_DEFINITION_VERSION = 1
CONSUMER_ANALYTICS = "analytics"
UNIQUE_LISTENERS_NOT_AVAILABLE = "NOT_AVAILABLE"
ACTIVATION_NOT_IMPLEMENTED = "NOT_IMPLEMENTED"

MONEY_OR_SECRET_KEYS = frozenset(
    {
        "amount_minor",
        "amount",
        "currency_code",
        "currency",
        "share_bps",
        "password",
        "secret",
        "token",
        "qr_secret",
        "pan",
        "kyc",
        "iban",
        "email",
        "legal_name",
    }
)


def metric_date_for(occurred_at: datetime) -> date:
    """Calendar date of occurred_at in ASSUMED Asia/Dhaka."""
    if occurred_at.tzinfo is None:
        occurred_at = occurred_at.replace(tzinfo=timezone.utc)
    return occurred_at.astimezone(DHAKA).date()


def sanitize_properties(payload: dict) -> dict:
    """Drop money/secrets/KYC. Facts may keep ids, counts, and durations."""
    clean: dict = {}
    for key, value in payload.items():
        lowered = str(key).lower()
        if lowered in MONEY_OR_SECRET_KEYS or any(part in lowered for part in MONEY_OR_SECRET_KEYS):
            continue
        if isinstance(value, (str, int, float, bool)) or value is None:
            clean[key] = value
        elif isinstance(value, dict):
            nested = sanitize_properties(value)
            if nested:
                clean[key] = nested
    return clean


def never_negative(value: int) -> int:
    return value if value >= 0 else 0


def unique_listeners_metric() -> str:
    """Q-P13-16 OPEN — do not calculate."""
    return UNIQUE_LISTENERS_NOT_AVAILABLE


def calculate_unique_listeners(*_args: object, **_kwargs: object) -> str:
    return UNIQUE_LISTENERS_NOT_AVAILABLE


def activation_metric() -> str:
    """Q-P13-17 / Q-P1-25 OPEN."""
    return ACTIVATION_NOT_IMPLEMENTED


def attribution_status() -> str:
    """Q-P13-18 / Q-P12-09 OPEN."""
    return ATTRIBUTION_UNDEFINED
