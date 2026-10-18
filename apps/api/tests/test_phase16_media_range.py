"""Phase 16 (music player): the audio media endpoint serves byte ranges so players can seek."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from cornerroom.api.deps import streaming_service
from cornerroom.infra.errors import AppError
from cornerroom.infra.http_range import RangeNotSatisfiable, parse_byte_range
from cornerroom.main import create_app

DATA = bytes(range(256)) * 4  # 1024 bytes


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, None),
        ("", None),
        ("bytes=0-99", (0, 99)),
        ("bytes=100-", (100, 1023)),
        ("bytes=-24", (1000, 1023)),
        ("bytes=1000-5000", (1000, 1023)),
        ("BYTES = 5 - 9", (5, 9)),
        ("bytes=0-", None),  # the whole file: a plain 200
        ("bytes=0-1023", None),
        ("bytes=-5000", None),
        ("bytes=0-9,20-29", None),  # several ranges: whole file (allowed by the RFC)
        ("items=0-9", None),
        ("bytes=9-5", None),
        ("bytes=-", None),
    ],
)
def test_phase16_parse_byte_range(header: str | None, expected: tuple[int, int] | None) -> None:
    assert parse_byte_range(header, len(DATA)) == expected


@pytest.mark.parametrize("header", ["bytes=1024-", "bytes=5000-6000", "bytes=-0"])
def test_phase16_unsatisfiable_ranges(header: str) -> None:
    with pytest.raises(RangeNotSatisfiable):
        parse_byte_range(header, len(DATA))


class _Asset:
    object_key = "k"
    mime = "audio/wav"


class _Storage:
    async def stat(self, key: str) -> int:
        return len(DATA)

    async def read_range(self, key: str, start: int, end: int):
        for i in range(start, end + 1, 64):
            yield DATA[i : min(end + 1, i + 64)]


class _Delivery:
    storage = _Storage()


class _FakeStreaming:
    """Stands in for StreamingService: the endpoint's access check lives in open_media."""

    delivery = _Delivery()

    def __init__(self, allow: bool) -> None:
        self.allow = allow
        self.calls = 0

    async def open_media(self, token: str) -> _Asset:
        self.calls += 1
        if not self.allow:
            raise AppError("ENTITLEMENT_REQUIRED", "Entitlement required", 403)
        return _Asset()


async def _get(fake: _FakeStreaming, headers: dict[str, str] | None = None):
    app = create_app()
    app.dependency_overrides[streaming_service] = lambda: fake
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.get("/api/v1/playback/media/token", headers=headers or {})


async def test_phase16_media_whole_file_advertises_ranges() -> None:
    res = await _get(_FakeStreaming(allow=True))
    assert res.status_code == 200
    assert res.headers["accept-ranges"] == "bytes"
    assert res.headers["content-type"] == "audio/wav"
    assert res.content == DATA


async def test_phase16_media_serves_a_range() -> None:
    res = await _get(_FakeStreaming(allow=True), {"Range": "bytes=100-199"})
    assert res.status_code == 206
    assert res.headers["content-range"] == "bytes 100-199/1024"
    assert res.headers["content-length"] == "100"
    assert res.content == DATA[100:200]


async def test_phase16_media_rejects_a_range_past_the_end() -> None:
    res = await _get(_FakeStreaming(allow=True), {"Range": "bytes=4096-"})
    assert res.status_code == 416
    assert res.headers["content-range"] == "bytes */1024"


async def test_phase16_media_range_still_checks_access() -> None:
    fake = _FakeStreaming(allow=False)
    res = await _get(fake, {"Range": "bytes=0-9"})
    assert fake.calls == 1
    assert res.status_code == 403
    assert b"\x00\x01" not in res.content
