"""Subscription lifecycles. PAUSED is P1 — not implemented. Do not invent trial/grace."""

from __future__ import annotations

from datetime import timedelta

from cornerroom.infra.errors import AppError
from cornerroom.kernel.calendar import add_billing_interval

PLAN_TRANSITIONS: dict[tuple[str, str], str] = {
    ("DRAFT", "ACTIVE"): "activate",
    ("ACTIVE", "RETIRED"): "retire",
}

SUBSCRIPTION_TRANSITIONS: dict[tuple[str, str], str] = {
    ("TRIALING", "ACTIVE"): "activate",
    ("TRIALING", "CANCELLED"): "cancel",
    ("ACTIVE", "PAST_DUE"): "past_due",
    ("ACTIVE", "CANCELLED"): "cancel",
    ("PAST_DUE", "ACTIVE"): "renew",
    ("PAST_DUE", "CANCELLED"): "cancel",
    ("PAST_DUE", "EXPIRED"): "expire",
    ("TRIALING", "EXPIRED"): "expire",
}

PERIOD_TRANSITIONS: dict[tuple[str, str], str] = {
    ("OPEN", "PAID"): "pay",
    ("OPEN", "UNPAID"): "unpaid",
    ("PAID", "CLOSED"): "close",
    ("UNPAID", "CLOSED"): "close",
    ("UNPAID", "PAID"): "pay",
}

NON_TERMINAL_SUBSCRIPTION = frozenset({"TRIALING", "ACTIVE", "PAST_DUE"})


def _transition(table: dict[tuple[str, str], str], current: str, target: str, label: str) -> str:
    if current == target:
        return "noop"
    action = table.get((current, target))
    if action is None:
        raise AppError(
            "INVALID_TRANSITION",
            f"This {label} transition is not allowed",
            409,
            f"{current} cannot move to {target}",
        )
    return action


def plan_transition_action(current: str, target: str) -> str:
    return _transition(PLAN_TRANSITIONS, current, target, "plan")


def subscription_transition_action(current: str, target: str) -> str:
    return _transition(SUBSCRIPTION_TRANSITIONS, current, target, "subscription")


def period_transition_action(current: str, target: str) -> str:
    return _transition(PERIOD_TRANSITIONS, current, target, "period")


def initial_subscription_status(trial_days: int | None) -> str:
    """Skip TRIALING when trial_days is NULL or 0 (Q-P9 — do not invent a trial)."""
    if trial_days is None or trial_days <= 0:
        return "ACTIVE"
    return "TRIALING"


def period_end(*, starts_at, interval: str, interval_count: int, trial_days: int | None, status: str):
    if status == "TRIALING" and trial_days and trial_days > 0:
        return starts_at + timedelta(days=trial_days)
    return add_billing_interval(starts_at, interval, interval_count)
