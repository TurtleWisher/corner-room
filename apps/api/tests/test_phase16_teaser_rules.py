"""Teaser rules and FFmpeg arguments (owner, 2026-11-07, D-TEASER-00 to D-TEASER-03). No database."""

from __future__ import annotations

from pathlib import Path

from cornerroom.infra.settings import Settings
from cornerroom.modules.documents.application import media_tools as tools
from cornerroom.modules.music.domain import teasers as rules


def _s(start: int, end: int, fi: int = 0, fo: int = 0, gain: int = 0) -> rules.Settings:
    return rules.Settings(start, end, fi, fo, gain)


def test_settings_problems() -> None:
    ok = dict(master_ms=180_000, min_ms=5_000, max_ms=60_000)
    assert rules.problems(_s(10_000, 40_000, 1_000, 2_000, -300), **ok) == []
    assert rules.problems(_s(0, 60_000), **ok) == []
    assert "TOO_LONG" in rules.problems(_s(0, 60_001), **ok)
    assert "TOO_SHORT" in rules.problems(_s(0, 4_999), **ok)
    assert rules.problems(_s(5_000, 5_000), **ok) == ["END_BEFORE_START"]
    assert "END_AFTER_SONG" in rules.problems(_s(170_000, 180_001), **ok)
    assert "START_BEFORE_SONG" in rules.problems(_s(-1, 10_000), **ok)
    assert "FADE_TOO_LONG" in rules.problems(_s(0, 10_000, 6_000), **ok)  # more than half the teaser
    assert "FADE_TOO_LONG" in rules.problems(_s(0, 60_000, 0, 10_001), **ok)
    assert "GAIN_OUT_OF_RANGE" in rules.problems(_s(0, 10_000, gain=601), **ok)
    assert "GAIN_OUT_OF_RANGE" in rules.problems(_s(0, 10_000, gain=-1201), **ok)


def test_no_configured_maximum_fails_closed() -> None:
    assert "TOO_LONG" in rules.problems(_s(0, 10_000), master_ms=180_000, min_ms=5_000, max_ms=0)


def test_default_settings_fit_the_song_and_the_limit() -> None:
    assert rules.default_settings(180_000, max_ms=60_000) == _s(0, 60_000)
    assert rules.default_settings(20_000, max_ms=60_000) == _s(0, 20_000)


def test_status_after() -> None:
    assert rules.status_after(has_live=False, live_shown=False, waiting=False) == rules.DRAFT
    assert rules.status_after(has_live=False, live_shown=False, waiting=True) == rules.IN_REVIEW
    assert rules.status_after(has_live=True, live_shown=True, waiting=True) == rules.PUBLISHED
    assert rules.status_after(has_live=True, live_shown=False, waiting=False) == rules.UNPUBLISHED


def test_artist_actions() -> None:
    draft = rules.VersionFacts(rules.V_DRAFT, None, False)
    ready = rules.VersionFacts(rules.V_READY, None, False)
    waiting = rules.VersionFacts(rules.V_READY, rules.WAITING, False)
    returned = rules.VersionFacts(rules.V_READY, rules.RETURNED, False)
    failed = rules.VersionFacts(rules.V_FAILED, None, False)
    live = rules.VersionFacts(rules.V_READY, rules.APPROVED, True)
    assert rules.artist_actions(rules.DRAFT, draft, ever_published=False) == ["process", "delete"]
    assert rules.artist_actions(rules.DRAFT, failed, ever_published=False) == ["process", "delete"]
    assert rules.artist_actions(rules.DRAFT, ready, ever_published=False) == ["submit", "delete"]
    assert rules.artist_actions(rules.IN_REVIEW, waiting, ever_published=False) == ["withdraw"]
    assert rules.artist_actions(rules.DRAFT, returned, ever_published=False) == ["submit", "delete"]
    assert rules.artist_actions(rules.PUBLISHED, live, ever_published=True) == ["unpublish"]
    assert rules.artist_actions(rules.UNPUBLISHED, live, ever_published=True) == ["republish"]
    # A newer version waits while the live one stays public; it can never be deleted once public.
    assert rules.artist_actions(rules.PUBLISHED, waiting, ever_published=True) == ["withdraw", "unpublish"]


def test_public_only_when_published_ready_and_song_present() -> None:
    base = dict(teaser_status=rules.PUBLISHED, teaser_deleted=False, live_ready=True, track_status="RELEASED",
                track_deleted=False)
    assert rules.public(**base)
    assert rules.public(**{**base, "track_status": "SCHEDULED"})  # before release too (D-TEASER-04)
    assert not rules.public(**{**base, "teaser_status": rules.UNPUBLISHED})
    assert not rules.public(**{**base, "teaser_status": rules.IN_REVIEW})
    assert not rules.public(**{**base, "live_ready": False})
    assert not rules.public(**{**base, "track_status": "TAKEN_DOWN"})
    assert not rules.public(**{**base, "track_deleted": True})
    assert not rules.public(**{**base, "teaser_deleted": True})


def test_teaser_filter_trims_fades_and_gain() -> None:
    f = tools.teaser_filter(start_ms=12_345, end_ms=42_345, fade_in_ms=1_500, fade_out_ms=2_000, gain_cdb=-350)
    assert f == (
        "atrim=start=12.345:end=42.345,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1.500,"
        "afade=t=out:st=28.000:d=2.000,volume=-3.50dB"
    )
    assert tools.teaser_filter(start_ms=0, end_ms=5_000, fade_in_ms=0, fade_out_ms=0, gain_cdb=0) == (
        "atrim=start=0.000:end=5.000,asetpts=PTS-STARTPTS"
    )


def test_teaser_args_read_the_master_only_and_never_lossless() -> None:
    settings = Settings(media_ffmpeg_path="ffmpeg")
    opus = tools.Profile("opus_160", "opus", "ogg", 160, 48000, 2, 1)
    args = tools.teaser_args(settings, Path("master.flac"), Path("out.ogg"), opus, "atrim=start=0:end=5")
    assert args[args.index("-i") + 1] == "master.flac" and args[-1] == "out.ogg"
    assert "-protocol_whitelist" in args and "-map_metadata" in args
    flac = tools.Profile("flac", "flac", "flac", 0, 0, 2, 1, "DOWNLOAD")
    try:
        tools.teaser_args(settings, Path("m.flac"), Path("o.flac"), flac, "x")
    except tools.MediaToolError as exc:
        assert exc.code == "UNKNOWN_PROFILE"
    else:
        raise AssertionError("a lossless teaser must be refused")


def test_peaks() -> None:
    import array

    samples = array.array("h", [0, 100, -32768, 50] + [16384] * 4)
    peaks = tools.peaks_from_pcm(samples.tobytes(), rate_hz=4000, bucket_ms=1)  # 4 samples per bucket
    assert peaks == [255, 128]
    assert tools.waveform_bucket_ms(1_000) == 10
    assert tools.waveform_bucket_ms(60 * 60 * 1000) == 180
