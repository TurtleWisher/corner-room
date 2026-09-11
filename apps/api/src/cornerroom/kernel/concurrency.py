"""Optimistic-lock primitive for future high-contention aggregates.

The SQLAlchemy mixin lives on persistence models (`infra.base.VersionMixin`).
Do not add version columns to every table — only where concurrent updates are expected.
"""

from __future__ import annotations


class StaleVersionError(Exception):
    """Raised when an optimistic lock check fails."""


def next_version(current: int) -> int:
    return current + 1
