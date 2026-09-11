"""Recognition invariants that do not need a database."""

from __future__ import annotations

from cornerroom.modules.finance.application.recognition import RecognitionService


def test_unset_share_bps_does_not_invent_platform_take() -> None:
    svc = RecognitionService.__new__(RecognitionService)
    net, take = svc._split_take(10_000, 0)
    assert net == 10_000
    assert take == 0


def test_configured_share_bps_is_integer_floor() -> None:
    svc = RecognitionService.__new__(RecognitionService)
    net, take = svc._split_take(10_000, 1_000)
    assert take == 1_000
    assert net == 9_000
    net, take = svc._split_take(100, 1)
    assert take == 0
    assert net == 100
