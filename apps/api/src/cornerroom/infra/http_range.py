"""HTTP byte ranges (RFC 9110 section 14) for media responses.

Browsers seek in audio by asking for part of the file (`Range: bytes=start-end`). Only a single
range is served; multipart ranges fall back to the whole file, which the RFC allows.
"""

from __future__ import annotations

import re

_SINGLE = re.compile(r"^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$", re.IGNORECASE)


class RangeNotSatisfiable(Exception):
    """The range starts past the end of the file (answer 416)."""


def parse_byte_range(header: str | None, size: int) -> tuple[int, int] | None:
    """Return the inclusive (start, end) to serve, or None to serve the whole file.

    None for: no header, a malformed header, several ranges, or a range covering everything.
    Raises RangeNotSatisfiable when the range cannot be served from a file of `size` bytes.
    """
    if not header:
        return None
    match = _SINGLE.match(header)
    if match is None:
        return None
    first, last = match.group(1), match.group(2)
    if first == "" and last == "":
        return None
    if first == "":
        # Suffix range: the final N bytes.
        suffix = int(last)
        if suffix == 0:
            raise RangeNotSatisfiable
        start, end = max(0, size - suffix), size - 1
    else:
        start = int(first)
        end = size - 1 if last == "" else min(int(last), size - 1)
        if start >= size:
            raise RangeNotSatisfiable
        if end < start:
            return None
    if size == 0:
        raise RangeNotSatisfiable
    if start == 0 and end == size - 1:
        return None
    return start, end
