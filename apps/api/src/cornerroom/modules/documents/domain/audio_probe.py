"""Read a master's format facts straight from its bytes (no external tool, no trust in names).

FLAC: the STREAMINFO block. WAV: the RIFF chunks (format code, channels, rate, bits, data size,
and anything after the data chunk). Everything else is classified by its signature as a lossy
format (MP3, AAC, Ogg, M4A, ...) or unsupported. Pure functions over a binary file object.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import BinaryIO

WAVE_FORMAT_PCM = 0x0001
WAVE_FORMAT_IEEE_FLOAT = 0x0003
WAVE_FORMAT_EXTENSIBLE = 0xFFFE


@dataclass(slots=True)
class AudioFacts:
    container: str  # "flac" | "wav" | "mp3" | "aac" | "ogg" | "mp4" | "unknown"
    codec: str | None = None
    lossy: bool = False
    sample_rate_hz: int | None = None
    bit_depth: int | None = None
    sample_format: str | None = None  # "int" | "float"
    channels: int | None = None
    duration_ms: int | None = None
    wav_format_code: int | None = None
    trailing_bytes: int = 0
    total_samples: int | None = None
    problems: list[str] = field(default_factory=list)


def probe(handle: BinaryIO, size: int) -> AudioFacts:
    handle.seek(0)
    head = handle.read(16)
    if len(head) < 4:
        return AudioFacts(container="unknown", problems=["ZERO_LENGTH" if size == 0 else "UNSUPPORTED_FORMAT"])
    if head[:4] == b"fLaC":
        return _probe_flac(handle)
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return _probe_wav(handle, size)
    lossy = _lossy_container(head)
    if lossy:
        return AudioFacts(container=lossy, lossy=True, problems=["LOSSY_SOURCE"])
    return AudioFacts(container="unknown", problems=["UNSUPPORTED_FORMAT"])


def _lossy_container(head: bytes) -> str | None:
    if head[:3] == b"ID3" or (len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0 and (head[1] & 0x06) != 0):
        return "mp3"
    if len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xF6) == 0xF0:
        return "aac"
    if head[:4] == b"OggS":
        return "ogg"
    if head[4:8] == b"ftyp":
        return "mp4"
    if head[:4] == b"\x30\x26\xb2\x75":
        return "wma"
    return None


def _probe_flac(handle: BinaryIO) -> AudioFacts:
    facts = AudioFacts(container="flac", codec="flac")
    handle.seek(4)
    header = handle.read(4)
    if len(header) < 4 or (header[0] & 0x7F) != 0:
        facts.problems.append("CORRUPT_AUDIO")
        return facts
    length = int.from_bytes(header[1:4], "big")
    info = handle.read(length)
    if length < 34 or len(info) < 34:
        facts.problems.append("CORRUPT_AUDIO")
        return facts
    # STREAMINFO bits: 16 min block, 16 max block, 24 min frame, 24 max frame, then
    # 20 sample rate, 3 channels-1, 5 bits-per-sample-1, 36 total samples.
    packed = int.from_bytes(info[10:18], "big")
    facts.sample_rate_hz = packed >> 44
    facts.channels = ((packed >> 41) & 0x7) + 1
    facts.bit_depth = ((packed >> 36) & 0x1F) + 1
    facts.total_samples = packed & 0xFFFFFFFFF
    facts.sample_format = "int"
    if facts.sample_rate_hz and facts.total_samples:
        facts.duration_ms = int(facts.total_samples * 1000 / facts.sample_rate_hz)
    if not facts.sample_rate_hz:
        facts.problems.append("CORRUPT_AUDIO")
    return facts


def _probe_wav(handle: BinaryIO, size: int) -> AudioFacts:
    facts = AudioFacts(container="wav", codec="pcm")
    handle.seek(12)
    fmt: bytes | None = None
    data_size: int | None = None
    pos = 12
    while pos + 8 <= size:
        handle.seek(pos)
        chunk = handle.read(8)
        if len(chunk) < 8:
            break
        cid, csize = chunk[:4], struct.unpack("<I", chunk[4:8])[0]
        body_start = pos + 8
        if cid == b"fmt ":
            fmt = handle.read(min(csize, 64))
        elif cid == b"data":
            data_size = csize
            end = body_start + csize
            if end > size:
                facts.problems.append("CORRUPT_AUDIO")  # declared longer than the file
                data_size = max(0, size - body_start)
                end = size
            # Word-aligned padding byte after an odd data chunk is allowed; anything more is not.
            facts.trailing_bytes = max(0, size - end - (csize & 1))
            break
        pos = body_start + csize + (csize & 1)
    if fmt is None or len(fmt) < 16 or data_size is None:
        facts.problems.append("CORRUPT_AUDIO")
        return facts
    code, channels, rate, _byte_rate, block_align, bits = struct.unpack("<HHIIHH", fmt[:16])
    facts.wav_format_code = code
    facts.channels = channels
    facts.sample_rate_hz = rate
    facts.bit_depth = bits
    facts.sample_format = "float" if code == WAVE_FORMAT_IEEE_FLOAT else "int"
    if code == WAVE_FORMAT_EXTENSIBLE and len(fmt) >= 40:
        sub = struct.unpack("<H", fmt[24:26])[0]
        facts.sample_format = "float" if sub == WAVE_FORMAT_IEEE_FLOAT else "int"
    if block_align and rate:
        frames = data_size // block_align
        facts.total_samples = frames
        facts.duration_ms = int(frames * 1000 / rate)
    if facts.trailing_bytes:
        facts.problems.append("WAV_TRAILING_DATA")
    if code != WAVE_FORMAT_PCM:
        facts.problems.append("WAV_NOT_PCM")
    return facts
