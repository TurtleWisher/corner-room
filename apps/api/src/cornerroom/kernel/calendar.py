"""Calendar interval arithmetic for billing periods. Not a product trial/grace rule (Q-P9-11)."""

from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta

from cornerroom.infra.errors import AppError

ALLOWED_INTERVALS = frozenset({"DAY", "WEEK", "MONTH", "YEAR"})


def add_billing_interval(start: datetime, interval: str, count: int) -> datetime:
    """Advance `start` by a staff-configured interval. count < 1 fails closed."""
    if count < 1:
        raise AppError(
            "VALIDATION_ERROR",
            "Billing interval_count must be a positive integer",
            422,
            "Do not invent a default billing length (Q-P9-11)",
        )
    kind = (interval or "").upper()
    if kind not in ALLOWED_INTERVALS:
        raise AppError(
            "VALIDATION_ERROR",
            "Unknown billing interval",
            422,
            "Interval is staff-configured data: DAY, WEEK, MONTH, or YEAR",
        )
    if kind == "DAY":
        return start + timedelta(days=count)
    if kind == "WEEK":
        return start + timedelta(weeks=count)
    if kind == "MONTH":
        month_index = start.month - 1 + count
        year = start.year + month_index // 12
        month = month_index % 12 + 1
        day = min(start.day, monthrange(year, month)[1])
        return start.replace(year=year, month=month, day=day)
    try:
        return start.replace(year=start.year + count)
    except ValueError:
        return start.replace(year=start.year + count, month=2, day=28)
