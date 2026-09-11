"""UUID v7 identifiers (RFC 9562)."""

from __future__ import annotations

import os
import time
import uuid


def new_uuid() -> uuid.UUID:
    """Return a time-ordered UUID version 7."""
    timestamp_ms = int(time.time() * 1000) & 0xFFFFFFFFFFFF
    uuid_bytes = bytearray(16)
    uuid_bytes[0:6] = timestamp_ms.to_bytes(6, "big")
    uuid_bytes[6:16] = os.urandom(10)
    uuid_bytes[6] = (uuid_bytes[6] & 0x0F) | 0x70
    uuid_bytes[8] = (uuid_bytes[8] & 0x3F) | 0x80
    return uuid.UUID(bytes=bytes(uuid_bytes))
