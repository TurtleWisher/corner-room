"""Pinned FFmpeg runner for media checks and playback copies (D-AUDIO-04, design section 7).

FFmpeg runs as a subprocess with no stdin, local files only (protocol whitelist), bit-exact output
flags so the same master and profile give the same file, and a wall-clock timeout. The master is
only ever read.
"""

from __future__ import annotations

import asyncio
import re
import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from cornerroom.infra.settings import Settings
from cornerroom.modules.documents.domain.qc import Loudness

_FLOAT = r"(-?(?:\d+(?:\.\d+)?|inf))"


class MediaToolError(Exception):
    """A tool failed in a way worth retrying (timeout, crash, missing binary)."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code


@dataclass(frozen=True, slots=True)
class Profile:
    key: str
    codec: str
    container: str
    bitrate_kbps: int
    sample_rate_hz: int
    channels: int
    profile_version: int
    purpose: str = "PLAYBACK"


def ffmpeg_path(settings: Settings) -> str:
    if settings.media_ffmpeg_path:
        return settings.media_ffmpeg_path
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


@lru_cache(maxsize=4)
def _version_of(path: str) -> str:
    try:
        out = subprocess.run([path, "-hide_banner", "-version"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise MediaToolError("TOOL_MISSING", str(exc)) from exc
    first = (out.stdout or "").splitlines()[0] if out.stdout else ""
    match = re.match(r"ffmpeg version (\S+)", first)
    return match.group(1) if match else "unknown"


def tool_version(settings: Settings) -> str:
    version = _version_of(ffmpeg_path(settings))
    expected = settings.media_ffmpeg_expected_version.strip()
    if expected and version != expected:
        raise MediaToolError("TOOL_VERSION_MISMATCH", f"found {version}, expected {expected}")
    return version


def _base(settings: Settings) -> list[str]:
    return [ffmpeg_path(settings), "-nostdin", "-hide_banner", "-protocol_whitelist", "file,pipe"]


async def _run(args: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    def call() -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout, errors="replace")

    try:
        return await asyncio.to_thread(call)
    except subprocess.TimeoutExpired as exc:
        raise MediaToolError("TOOL_TIMEOUT", f"after {timeout}s") from exc
    except OSError as exc:
        raise MediaToolError("TOOL_MISSING", str(exc)) from exc


def _last_float(pattern: str, text: str) -> float | None:
    found = re.findall(pattern, text)
    if not found:
        return None
    value = found[-1]
    if value in {"inf", "-inf"}:
        return None
    return float(value)


def _out_time_ms(progress: str) -> int | None:
    found = re.findall(r"out_time_us=(\d+)", progress)
    return int(found[-1]) // 1000 if found else None


async def analyse(settings: Settings, source: Path) -> Loudness:
    """One full decode: integrity (stop at the first error) plus EBU R128 loudness and true peak."""
    args = _base(settings) + [
        "-xerror",
        "-i", str(source),
        "-map", "0:a:0",
        "-af", "ebur128=peak=true:framelog=quiet",
        "-f", "null",
        "-progress", "pipe:1",
        "-nostats",
        "-",
    ]
    result = await _run(args, settings.media_job_timeout_seconds)
    log = result.stderr
    return Loudness(
        integrated_lufs=_last_float(r"\bI:\s+" + _FLOAT + r" LUFS", log),
        loudness_range_lu=_last_float(r"\bLRA:\s+" + _FLOAT + r" LU\b", log),
        true_peak_dbtp=_last_float(r"\bPeak:\s+" + _FLOAT + r" dBFS", log),
        decoded_ms=_out_time_ms(result.stdout),
        decode_ok=result.returncode == 0,
    )


async def decoded_duration_ms(settings: Settings, source: Path) -> int | None:
    args = _base(settings) + ["-xerror", "-i", str(source), "-f", "null", "-progress", "pipe:1", "-nostats", "-"]
    result = await _run(args, settings.media_job_timeout_seconds)
    if result.returncode != 0:
        return None
    return _out_time_ms(result.stdout)


async def transcode(settings: Settings, source: Path, target: Path, profile: Profile) -> None:
    """Make a playback copy from the master. Bit-exact flags and no copied metadata keep it
    reproducible; the output never carries the master's tags."""
    common = [
        "-i", str(source),
        "-map", "0:a:0",
        "-map_metadata", "-1",
        "-fflags", "+bitexact",
        "-flags:a", "+bitexact",
        "-ac", str(profile.channels),
    ]
    # 0 keeps the master's sample rate (lossless download copies).
    if profile.sample_rate_hz:
        common += ["-ar", str(profile.sample_rate_hz)]
    if profile.codec == "opus":
        codec = ["-c:a", "libopus", "-b:a", f"{profile.bitrate_kbps}k", "-vbr", "on", "-application", "audio",
                 "-serial_offset", "0", "-f", "ogg"]
    elif profile.codec == "mp3":
        codec = ["-c:a", "libmp3lame", "-b:a", f"{profile.bitrate_kbps}k", "-id3v2_version", "0",
                 "-write_xing", "1", "-f", "mp3"]
    elif profile.codec == "flac":
        # Lossless: same samples as the master, bit depth kept (24-bit stays 24-bit).
        codec = ["-c:a", "flac", "-compression_level", "8", "-f", "flac"]
    else:
        raise MediaToolError("UNKNOWN_PROFILE", profile.codec)
    args = _base(settings) + ["-y"] + common + codec + [str(target)]
    result = await _run(args, settings.media_job_timeout_seconds)
    if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
        tail = (result.stderr or "").strip().splitlines()[-1:] or [""]
        raise MediaToolError("TRANSCODE_FAILED", tail[0][:200])
