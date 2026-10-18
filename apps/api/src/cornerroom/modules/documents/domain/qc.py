"""Media check rules (D-AUDIO-02, D-AUDIO-08, D-AUDIO-17, S2, S8, S11). Pure: facts in, findings out.

BLOCK findings stop a file; WARN findings are shown to the artist and reviewer but never block.
Codes are stable API values; copy for people lives in the clients.
"""

from __future__ import annotations

from dataclasses import dataclass

from cornerroom.modules.documents.domain.audio_probe import AudioFacts

BLOCK = "BLOCK"
WARN = "WARN"

MIN_SAMPLE_RATE_HZ = 44100
ACCEPTED_BIT_DEPTHS = frozenset({16, 24})
LOUDNESS_TARGET_LUFS = -14.0
TRUE_PEAK_WARN_DBTP = -1.0
LOUD_MASTER_TRUE_PEAK_WARN_DBTP = -2.0
DECODE_SHORTFALL_TOLERANCE_MS = 500


@dataclass(frozen=True, slots=True)
class Finding:
    code: str
    severity: str
    measured: str | None = None
    limit: str | None = None


@dataclass(frozen=True, slots=True)
class Loudness:
    integrated_lufs: float | None
    loudness_range_lu: float | None
    true_peak_dbtp: float | None
    decoded_ms: int | None
    decode_ok: bool


def format_findings(facts: AudioFacts, *, byte_size: int, max_bytes: int, max_duration_s: int) -> list[Finding]:
    """Checks that need only the header. Run before any decoding (cheapest first)."""
    out: list[Finding] = []
    if byte_size == 0:
        return [Finding("ZERO_LENGTH", BLOCK)]
    if byte_size > max_bytes:
        out.append(Finding("FILE_TOO_LARGE", BLOCK, str(byte_size), str(max_bytes)))
    for code in facts.problems:
        out.append(Finding(code, BLOCK))
    if facts.lossy or facts.container not in {"flac", "wav"}:
        return _dedupe(out)
    if facts.channels is not None and facts.channels != 2:
        out.append(Finding("NOT_STEREO", BLOCK, str(facts.channels), "2"))
    if facts.sample_rate_hz is not None and facts.sample_rate_hz < MIN_SAMPLE_RATE_HZ:
        out.append(Finding("SAMPLE_RATE_TOO_LOW", BLOCK, f"{facts.sample_rate_hz} Hz", f"{MIN_SAMPLE_RATE_HZ} Hz"))
    if facts.sample_format == "float" or (facts.bit_depth is not None and facts.bit_depth not in ACCEPTED_BIT_DEPTHS):
        measured = f"{facts.bit_depth}-bit {facts.sample_format or ''}".strip()
        out.append(Finding("BIT_DEPTH_UNSUPPORTED", BLOCK, measured, "16 or 24-bit"))
    if facts.duration_ms is not None:
        if facts.duration_ms == 0:
            out.append(Finding("ZERO_LENGTH", BLOCK))
        elif facts.duration_ms > max_duration_s * 1000:
            out.append(Finding("DURATION_TOO_LONG", BLOCK, f"{facts.duration_ms // 1000} s", f"{max_duration_s} s"))
    return _dedupe(out)


def decode_findings(facts: AudioFacts, loud: Loudness) -> list[Finding]:
    """Checks that need a full decode: integrity and loudness."""
    out: list[Finding] = []
    if not loud.decode_ok:
        out.append(Finding("CORRUPT_AUDIO", BLOCK))
    elif (
        facts.duration_ms is not None
        and loud.decoded_ms is not None
        and loud.decoded_ms + DECODE_SHORTFALL_TOLERANCE_MS < facts.duration_ms
    ):
        out.append(Finding("CORRUPT_AUDIO", BLOCK, f"{loud.decoded_ms} ms decoded", f"{facts.duration_ms} ms"))
    peak = loud.true_peak_dbtp
    lufs = loud.integrated_lufs
    if peak is not None:
        if lufs is not None and lufs > LOUDNESS_TARGET_LUFS and peak > LOUD_MASTER_TRUE_PEAK_WARN_DBTP:
            out.append(Finding("LOUD_MASTER_PEAK", WARN, f"{lufs:.1f} LUFS, {peak:.1f} dBTP", "-2 dBTP"))
        elif peak > TRUE_PEAK_WARN_DBTP:
            out.append(Finding("TRUE_PEAK_HIGH", WARN, f"{peak:.1f} dBTP", "-1 dBTP"))
    return out


def outcome(findings: list[Finding]) -> str:
    if any(f.severity == BLOCK for f in findings):
        return "REJECTED"
    if findings:
        return "ACCEPTED_WITH_WARNINGS"
    return "ACCEPTED"


def playback_gain_db(integrated_lufs: float | None, true_peak_dbtp: float | None) -> float | None:
    """Gain that levels a song to about -14 LUFS: always down for loud songs; up for quiet ones only
    as far as the peaks allow with 1 dB headroom (D-AUDIO-08, design 7)."""
    if integrated_lufs is None:
        return None
    gain = LOUDNESS_TARGET_LUFS - integrated_lufs
    if gain > 0:
        headroom = max(0.0, -1.0 - true_peak_dbtp) if true_peak_dbtp is not None else 0.0
        gain = min(gain, headroom)
    return round(gain, 2)


def cover_findings(
    *, fmt: str | None, width: int | None, height: int | None, mode: str | None, byte_size: int,
    max_bytes: int, min_px: int, max_px: int,
) -> list[Finding]:
    out: list[Finding] = []
    if byte_size > max_bytes:
        out.append(Finding("FILE_TOO_LARGE", BLOCK, str(byte_size), str(max_bytes)))
    if fmt not in {"JPEG", "PNG"}:
        out.append(Finding("COVER_FORMAT", BLOCK, fmt or "unknown", "JPEG or PNG"))
        return out
    if width is None or height is None:
        out.append(Finding("COVER_UNREADABLE", BLOCK))
        return out
    if width != height:
        out.append(Finding("COVER_NOT_SQUARE", BLOCK, f"{width}x{height}", "square"))
    if min(width, height) < min_px:
        out.append(Finding("COVER_TOO_SMALL", BLOCK, f"{width}x{height}", f"{min_px} px"))
    if max(width, height) > max_px:
        out.append(Finding("COVER_TOO_LARGE", BLOCK, f"{width}x{height}", f"{max_px} px"))
    if mode not in {"RGB", "RGBA", "L", "P"}:
        out.append(Finding("COVER_COLOR_MODE", BLOCK, mode or "unknown", "RGB"))
    elif width < 3000:
        out.append(Finding("COVER_BELOW_RECOMMENDED", WARN, f"{width} px", "3000 px"))
    return out


def _dedupe(findings: list[Finding]) -> list[Finding]:
    seen: set[str] = set()
    out: list[Finding] = []
    for f in findings:
        if f.code in seen:
            continue
        seen.add(f.code)
        out.append(f)
    return out
