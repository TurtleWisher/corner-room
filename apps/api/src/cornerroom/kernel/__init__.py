"""Shared kernel — no business-vertical rules."""

from cornerroom.kernel.auth_context import AuthContext
from cornerroom.kernel.clock import Clock, SystemClock
from cornerroom.kernel.concurrency import StaleVersionError
from cornerroom.kernel.correlation import new_correlation_id, resolve_correlation_id
from cornerroom.kernel.events import DomainEvent
from cornerroom.kernel.ids import new_uuid
from cornerroom.kernel.money import Money
from cornerroom.kernel.pagination import clamp_limit, decode_cursor, encode_cursor
from cornerroom.kernel.result import Err, Ok, Result

__all__ = [
    "AuthContext",
    "Clock",
    "DomainEvent",
    "Err",
    "Money",
    "Ok",
    "Result",
    "StaleVersionError",
    "SystemClock",
    "clamp_limit",
    "decode_cursor",
    "encode_cursor",
    "new_correlation_id",
    "new_uuid",
    "resolve_correlation_id",
]
