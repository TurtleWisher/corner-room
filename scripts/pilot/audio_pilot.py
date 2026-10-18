"""End-to-end audio pilot (AUDIO Phase 9) against a running staging copy.

Walks the whole journey over the public HTTP API, the way people would:

  artist applies -> staff approve the artist -> artist makes a single in Studio -> uploads a real
  (original, synthesised) master -> the worker inspects it and makes copies -> artist adds a cover,
  details and a price, and submits -> a different staff member reviews and releases it -> ops accept
  the price -> a fan plays it (start, seek by byte range) -> buys it (payment confirmed only by a
  signed provider callback, as in production) -> finds it in the library -> downloads FLAC and MP3
  and checks them -> staff views prove no personal data -> the staging logs hold no signed links.

It measures each step and writes var/staging/pilot-<time>.json and .md. Exit code 0 only when every
check passes. Run through scripts/staging.ps1 pilot (which loads staging.env); never against
development or production.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import io
import json
import math
import os
import struct
import sys
import time
import uuid
import wave
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "api" / "src"))

PERSONAL_KEYS = {"email", "legal_name", "phone", "phone_number", "date_of_birth", "dob", "address", "national_id", "nid", "password"}


# --- the test song: original, synthesised here, nothing to license --------------------------


def compose_master(seconds: float = 40.0, rate: int = 48000) -> bytes:
    """A short original piece (pad chords, a melody, a soft pulse) as 24-bit stereo WAV."""
    chords = [(220.00, 277.18, 329.63), (196.00, 246.94, 293.66), (174.61, 220.00, 261.63), (196.00, 246.94, 329.63)]
    melody = [659.25, 587.33, 523.25, 587.33, 659.25, 659.25, 659.25, 587.33, 587.33, 659.25, 783.99, 783.99]
    bar = seconds / 8
    frames = int(seconds * rate)
    out = bytearray()
    two_pi = 2 * math.pi
    for n in range(frames):
        t = n / rate
        chord = chords[int(t / bar) % len(chords)]
        swell = 0.5 - 0.5 * math.cos(two_pi * min(1.0, (t % bar) / bar))
        pad = sum(math.sin(two_pi * f * t) + 0.3 * math.sin(two_pi * 2 * f * t) for f in chord) / 6
        note_len = bar / 3
        note = melody[int(t / note_len) % len(melody)]
        pos = (t % note_len) / note_len
        env = min(1.0, pos * 30) * math.exp(-3.0 * pos)
        lead = math.sin(two_pi * note * t) * env
        pulse = math.sin(two_pi * 55 * t) * math.exp(-12 * ((t % (bar / 4)) / (bar / 4)))
        fade = min(1.0, t / 1.5, (seconds - t) / 2.0)
        left = fade * (0.35 * pad * (0.6 + 0.4 * swell) + 0.28 * lead + 0.22 * pulse)
        right = fade * (0.35 * pad * (0.6 + 0.4 * (1 - swell)) + 0.24 * lead + 0.22 * pulse)
        for value in (left, right):
            sample = max(-8388607, min(8388607, int(value * 8388607 * 0.8)))
            out += struct.pack("<i", sample)[:3]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(rate)
        w.writeframes(bytes(out))
    return buf.getvalue()


def cover_png(size: int = 3000) -> bytes:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (size, size), (24, 36, 88))
    draw = ImageDraw.Draw(img)
    for i in range(0, size, 150):
        draw.rectangle([i, size - i - 300, i + 300, size - i], outline=(250, 210, 80), width=18)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# --- report --------------------------------------------------------------------------------


@dataclass
class Report:
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    checks: list[dict[str, Any]] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.checks.append({"check": name, "ok": bool(ok), "detail": detail})
        print(f"{'PASS' if ok else 'FAIL'}  {name}{('  - ' + detail) if detail else ''}", flush=True)
        return bool(ok)

    @property
    def passed(self) -> bool:
        return all(c["ok"] for c in self.checks)


class Timer:
    def __init__(self) -> None:
        self.started = time.perf_counter()

    @property
    def ms(self) -> int:
        return round((time.perf_counter() - self.started) * 1000)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def personal_keys(value: Any, path: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            if str(k).lower() in PERSONAL_KEYS:
                found.append(f"{path}.{k}")
            found += personal_keys(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            found += personal_keys(v, f"{path}[{i}]")
    return found


# --- the journey ---------------------------------------------------------------------------


class Pilot:
    def __init__(self, api: str, out: Path, audio: Path | None) -> None:
        self.api = api.rstrip("/")
        self.out = out
        self.audio = audio
        self.report = Report()
        self.run = uuid.uuid4().hex[:8]
        self.http = httpx.AsyncClient(base_url=self.api, timeout=120)
        self.secrets_seen: list[str] = []
        self.emails_seen: list[str] = []

    async def call(self, method: str, path: str, token: str | None = None, **kw: Any) -> httpx.Response:
        headers = {**(kw.pop("headers", None) or {}), **(bearer(token) if token else {})}
        return await self.http.request(method, path, headers=headers, **kw)

    async def ok(self, method: str, path: str, token: str | None = None, expect: int = 200, **kw: Any) -> Any:
        res = await self.call(method, path, token, **kw)
        if res.status_code != expect:
            raise RuntimeError(f"{method} {path} -> {res.status_code}: {res.text[:400]}")
        return res.json() if res.content else None

    async def login(self, email: str, password: str) -> dict:
        return await self.ok("POST", "/api/v1/auth/login", json={"email": email, "password": password})

    async def person(self, admin: str, role: str, password: str) -> tuple[dict, str]:
        email = f"pilot-{role}-{self.run}@example.com"
        self.emails_seen.append(email)
        user = (await self.ok("POST", "/api/v1/auth/register", expect=201, json={"email": email, "password": password, "display_name": f"Pilot {role}"}))["user"]
        # Staging has no dev verification shortcut: an admin approves pilot accounts explicitly.
        await self.ok("POST", f"/api/v1/users/{user['id']}/lifecycle", admin, json={"action": "activate"})
        return await self.login(email, password), email

    async def staff(self, admin: str, label: str, role_key: str, name: str, password: str) -> str:
        session, _email = await self.person(admin, name, password)
        roles = await self.ok("GET", "/api/v1/roles", admin)
        role = next(r for r in roles if r["key"] == role_key)
        await self.ok("POST", f"/api/v1/organizations/{label}/memberships", admin, expect=201, json={"user_id": session["user"]["id"], "status": "ACTIVE", "role_id": role["id"]})
        return (await self.ok("POST", f"/api/v1/organizations/{label}/switch", session["access_token"]))["access_token"]

    async def upload(self, token: str, purpose: str, target_type: str, target_id: str, data: bytes, name: str) -> dict:
        timer = Timer()
        intent = await self.ok("POST", "/api/v1/uploads/intents", token, expect=201, json={"purpose": purpose, "target_type": target_type, "target_id": target_id, "filename": name, "byte_size": len(data)})
        for n in range(1, intent["part_count"] + 1):
            chunk = data[(n - 1) * intent["part_size"] : n * intent["part_size"]]
            await self.ok("PUT", f"/api/v1/uploads/intents/{intent['id']}/parts/{n}", token, headers={"X-Part-SHA256": hashlib.sha256(chunk).hexdigest()}, content=chunk)
        done = await self.ok("POST", f"/api/v1/uploads/intents/{intent['id']}/complete", token)
        return {"ms": timer.ms, "bytes": len(data), "parts": intent["part_count"], "intent": done}

    async def wait_ready(self, token: str, track_id: str, version_id: str, limit_s: int = 600) -> dict:
        timer = Timer()
        while timer.ms < limit_s * 1000:
            report = await self.ok("GET", f"/api/v1/tracks/{track_id}/versions/{version_id}/media-report", token)
            if report["status"] in {"READY", "REJECTED", "FAILED"}:
                report["_wait_ms"] = timer.ms
                return report
            await asyncio.sleep(1)
        raise RuntimeError("the worker did not finish the master in time (is .\\scripts\\staging.ps1 worker running?)")

    async def journey(self) -> None:
        r = self.report
        health = await self.call("GET", "/health/live")
        if not r.check("staging API is up", health.status_code == 200, self.api):
            return
        password = f"Pilot-{uuid.uuid4().hex[:12]}"
        admin_session = await self.login(os.environ["BOOTSTRAP_ADMIN_EMAIL"], os.environ["BOOTSTRAP_ADMIN_PASSWORD"])
        admin = admin_session["access_token"]
        orgs = (await self.ok("GET", "/api/v1/organizations", admin))["items"]
        label = next(o["id"] for o in orgs if o["type"] == "LABEL")
        admin_label = (await self.ok("POST", f"/api/v1/organizations/{label}/switch", admin))["access_token"]

        # Shared-server rules hold in staging: no dev shortcuts.
        probe = await self.call("POST", "/api/v1/auth/register", json={"email": f"pilot-probe-{self.run}@example.com", "password": password, "display_name": "Probe"})
        r.check("sign-up hands out no verification shortcut", probe.status_code == 201 and "verify" not in probe.text.lower().replace("pending_verification", ""), str(probe.status_code))

        # 1. The artist applies; staff approve and activate them in the label.
        artist_session, artist_email = await self.person(admin, "artist", password)
        artist = artist_session["access_token"]
        artist_user = artist_session["user"]["id"]
        application = await self.ok("POST", "/api/v1/artist-applications", artist, expect=201, json={"stage_name": f"Pilot Act {self.run}", "legal_name": "Pilot Private Legal Name"})
        for action in ("start_review", "approve"):
            await self.ok("POST", f"/api/v1/artist-applications/{application['id']}/lifecycle", admin_label, json={"action": action})
        await self.ok("POST", f"/api/v1/artists/{application['artist_id']}/lifecycle", admin_label, json={"action": "activate"})
        profiles = await self.ok("GET", "/api/v1/me/catalog-profiles", artist)
        mine = next((p for p in profiles if p["id"] == application["artist_id"]), None)
        r.check("approved artist can publish from Studio", mine is not None and mine.get("can_publish") is True, (mine or {}).get("reason") or "")

        reviewer = await self.staff(admin, label, "content_manager", "reviewer", password)
        ops = await self.staff(admin, label, "finance_manager", "ops", password)

        # 2. Studio: a single, real master, cover, details, price, submit.
        detail = await self.ok("POST", "/api/v1/studio/releases", artist, expect=201, json={"profile": {"kind": "artist", "id": application["artist_id"]}, "release_type": "SINGLE", "title": f"Pilot Light {self.run}"})
        release_id = detail["release"]["id"]
        await self.ok("PATCH", f"/api/v1/studio/releases/{release_id}", artist, json={"language_code": "bn", "genre_primary": "adhunik", "p_line": "â„— 2026 Pilot", "c_line": "Â© 2026 Pilot"})
        track_id = (await self.ok("POST", f"/api/v1/studio/releases/{release_id}/tracks", artist, expect=201, json={"title": f"Pilot Light {self.run}"}))["tracks"][0]["id"]
        version_id = (await self.ok("POST", f"/api/v1/studio/tracks/{track_id}/versions", artist, expect=201))["version_id"]
        master = self.audio.read_bytes() if self.audio else compose_master()
        up = await self.upload(artist, "AUDIO_MASTER", "track_version", version_id, master, self.audio.name if self.audio else "pilot-light.wav")
        r.metrics["upload"] = {k: up[k] for k in ("ms", "bytes", "parts")}
        done = up["intent"]
        same = done.get("sha256") == hashlib.sha256(master).hexdigest()
        r.check(
            "master uploaded in parts; the server holds exactly these bytes",
            done.get("intent", {}).get("status") == "COMPLETED" and same and done.get("byte_size") == len(master),
            f"{up['bytes']} bytes in {up['parts']} part(s), {up['ms']} ms, SHA-256 {'matches' if same else 'DIFFERS'}",
        )
        cover = await self.upload(artist, "COVER_ART", "release_cover", release_id, cover_png(), "cover.png")
        r.metrics["cover_upload_ms"] = cover["ms"]

        media = await self.wait_ready(artist, track_id, version_id)
        r.metrics["processing"] = {
            "wait_ms": media["_wait_ms"],
            "jobs": [{k: j.get(k) for k in ("kind", "profile_key", "status", "attempts", "last_error_code")} for j in media["jobs"]],
            "copies": [{k: c.get(k) for k in ("profile_key", "codec", "purpose", "bitrate_kbps", "sample_rate_hz", "bit_depth", "byte_size")} for c in media["renditions"]],
            "inspection": {k: (media.get("inspection") or {}).get(k) for k in ("sample_rate_hz", "bit_depth", "channels", "duration_ms", "integrated_lufs", "true_peak_dbtp")},
        }
        r.metrics["storage_bytes"] = {"master": len(master), "copies": sum(c["byte_size"] for c in media["renditions"])}
        r.check("worker checked the master and made every copy", media["status"] == "READY", f"{media['status']} after {media['_wait_ms']} ms")
        purposes = {(c["codec"], c.get("purpose")) for c in media["renditions"]}
        r.check("playback copies and the lossless download copy exist", {("opus", "PLAYBACK"), ("mp3", "PLAYBACK"), ("flac", "DOWNLOAD")} <= purposes, str(sorted(purposes)))
        failed_jobs = [j for j in media["jobs"] if j["status"] not in {"SUCCEEDED"}]
        r.check("no failed or retried jobs", not failed_jobs and all((j.get("attempts") or 1) <= 1 for j in media["jobs"]), json.dumps(failed_jobs))

        await self.ok("POST", f"/api/v1/studio/releases/{release_id}/price-proposals", artist, expect=201, json={"subject_type": "RELEASE", "subject_id": release_id, "amount_minor": 4000})
        # The cover is checked by the worker too; give it a moment before submitting.
        for _ in range(60):
            readiness = await self.ok("GET", f"/api/v1/studio/releases/{release_id}/readiness", artist)
            if readiness.get("ready"):
                break
            await asyncio.sleep(1)
        r.check("Studio says the release is ready to submit", readiness.get("ready") is True, json.dumps([i for i in readiness.get("items", []) if not i.get("ok")]))
        submitted = await self.call("POST", f"/api/v1/studio/releases/{release_id}/submit", artist, json={"rights_declaration": True})
        r.check("artist submitted with the rights declaration", submitted.status_code == 200, submitted.text[:200] if submitted.status_code != 200 else "")

        # 3. Staff: privacy of the intake views, then review by a different person.
        staff_views = {
            "profiles": await self.call("GET", "/api/v1/catalog-intake/profiles", reviewer),
            "queue": await self.call("GET", "/api/v1/catalog-intake/queue", reviewer),
            "release": await self.call("GET", f"/api/v1/studio/releases/{release_id}", reviewer),
            "media_report": await self.call("GET", f"/api/v1/tracks/{track_id}/versions/{version_id}/media-report", reviewer),
        }
        leaks = []
        for name, res in staff_views.items():
            if res.status_code != 200:
                leaks.append(f"{name}: HTTP {res.status_code}")
                continue
            text = res.text
            for secret in (artist_email, artist_user, "Pilot Private Legal Name"):
                if secret in text:
                    leaks.append(f"{name}: contains {('email' if '@' in secret else 'user id' if secret == artist_user else 'legal name')}")
            leaks += [f"{name}: key {k}" for k in personal_keys(res.json())]
        r.check("staff views carry no personal profile data", not leaks, "; ".join(leaks))
        for action in ("start_review", "approve", "release"):
            res = await self.call("POST", f"/api/v1/catalog-intake/releases/{release_id}/review", reviewer, json={"action": action})
            if not r.check(f"reviewer: {action}", res.status_code == 200, res.text[:200] if res.status_code != 200 else ""):
                return
        queue = await self.ok("GET", "/api/v1/offer-proposals", ops)
        proposal = next(p for p in queue if p["release_id"] == release_id)
        await self.ok("POST", f"/api/v1/offer-proposals/{proposal['id']}/decision", ops, json={"decision": "accept"})
        offer = next(o for o in (await self.ok("GET", "/api/v1/offers"))["items"] if o.get("subject_id") == release_id)
        r.check("accepted price is on sale", offer["amount_minor"] == 4000 and offer["product_type"] == "RELEASE")

        # 4. The fan: buy first (plays need access), then stream and seek.
        fan_session, _fan_email = await self.person(admin, "fan", password)
        fan = fan_session["access_token"]
        public = await self.call("GET", f"/api/v1/releases/{release_id}")
        r.check("release is public", public.status_code == 200 and public.json()["status"] == "RELEASED")
        before = await self.call("GET", f"/api/v1/playback/tracks/{track_id}/audio", fan)
        r.check("not playable before buying", before.status_code in (402, 403), str(before.status_code))

        # D-ADDR-01: a Bangladesh delivery address is saved and confirmed before paying.
        await self.ok("PUT", "/api/v1/me/delivery-address", fan, json={
            "recipient_name": "Pilot Fan", "phone": "01712345678", "division": "Dhaka", "district": "Dhaka",
            "upazila": "Dhanmondi", "area": "Road 27", "house_road": "House 12, Road 27",
        })
        timer = Timer()
        order = await self.ok("POST", "/api/v1/orders", fan, expect=201, headers={"Idempotency-Key": f"pilot-{self.run}"}, json={"offer_id": offer["id"], "delivery_address_confirmed": True})
        shortcut = await self.call("POST", f"/api/v1/payments/{order['payment']['id']}/sandbox-confirm", fan)
        r.check("staging refuses self-confirmed payments", shortcut.status_code in (403, 404, 409), str(shortcut.status_code))
        from cornerroom.modules.finance.application.sandbox import sign_sandbox_payload

        payload = {"payment_id": order["payment"]["id"], "amount_minor": order["payment"]["amount_minor"], "currency_code": order["payment"]["currency_code"], "provider_event_id": f"pilot-evt-{self.run}", "status": "CAPTURED"}
        signature = sign_sandbox_payload(payload, os.environ["SANDBOX_PAYMENT_SECRET"])
        paid = await self.call("POST", "/api/v1/payments/callbacks", headers={"X-CornerRoom-Payment-Signature": signature}, json=payload)
        replay = await self.call("POST", "/api/v1/payments/callbacks", headers={"X-CornerRoom-Payment-Signature": signature}, json=payload)
        r.metrics["purchase_ms"] = timer.ms
        r.check("signed provider callback fulfils the order", paid.status_code == 200 and paid.json()["status"] == "FULFILLED", paid.text[:200] if paid.status_code != 200 else "")
        r.check("repeated callback is harmless", replay.status_code == 200)
        library = (await self.ok("GET", "/api/v1/me/library", fan))["items"]
        r.check("release is in the fan's library", any(i["item_type"] == "release" and i["item_id"] == release_id for i in library))

        timer = Timer()
        session = await self.ok("POST", "/api/v1/playback/sessions", fan, expect=201, json={"track_id": track_id, "device": "pilot"})
        audio = await self.ok("GET", f"/api/v1/playback/tracks/{track_id}/audio?accept=opus,mp3", fan)
        self.secrets_seen.append(audio["url"].rsplit("/", 1)[-1])
        self.secrets_seen += [a["url"].rsplit("/", 1)[-1] for a in audio.get("alternates", [])]
        first = await self.call("GET", audio["url"], headers={"Range": "bytes=0-65535"})
        startup_ms = timer.ms
        total = int(first.headers.get("content-range", "bytes 0-0/0").split("/")[-1] or 0)
        r.metrics["playback"] = {"startup_ms": startup_ms, "codec": audio.get("codec"), "bitrate_kbps": audio.get("bitrate_kbps"), "gain_db": audio.get("gain_db"), "copy_bytes": total}
        r.check("playback starts from a verified copy, never the master", first.status_code == 206 and audio.get("codec") in {"opus", "mp3"} and not audio.get("legacy_delivery"), f"{audio.get('codec')} {audio.get('bitrate_kbps')} kbps, first bytes in {startup_ms} ms")
        mid = total // 2
        timer = Timer()
        seek = await self.call("GET", audio["url"], headers={"Range": f"bytes={mid}-{mid + 32767}"})
        r.metrics["playback"]["seek_ms"] = timer.ms
        r.check("seeking returns just the asked-for bytes", seek.status_code == 206 and seek.headers.get("content-range", "").startswith(f"bytes {mid}-") and len(seek.content) == 32768, seek.headers.get("content-range", ""))
        past = await self.call("GET", audio["url"], headers={"Range": f"bytes={total + 10}-"})
        r.check("a range past the end is refused properly", past.status_code == 416)
        await self.call("POST", f"/api/v1/playback/sessions/{session['id']}/close", fan, json={"version": session["version"]})

        # 5. Downloads: lossless and MP3, checked byte for byte.
        r.metrics["downloads"] = {}
        for fmt in ("flac", "mp3"):
            timer = Timer()
            grant = await self.ok("POST", "/api/v1/me/downloads", fan, expect=201, json={"track_id": track_id, "format": fmt})
            self.secrets_seen.append(grant["url"].rsplit("/", 1)[-1])
            body = await self.call("GET", grant["url"])
            digest_ok = hashlib.sha256(body.content).hexdigest() == grant["sha256"]
            r.metrics["downloads"][fmt] = {"ms": timer.ms, "bytes": len(body.content), "filename": grant["filename"]}
            extra = ""
            if fmt == "flac" and body.content[:4] == b"fLaC":
                # STREAMINFO: 'fLaC', 4-byte block header, 10 bytes of block/frame sizes, then
                # 20 bits sample rate, 3 bits channels-1, 5 bits bits-per-sample-1.
                info = body.content[18:22]
                rate = (info[0] << 12) | (info[1] << 4) | (info[2] >> 4)
                bits = (((info[2] & 0x01) << 4) | (info[3] >> 4)) + 1
                extra = f", {bits}-bit / {rate} Hz"
                r.metrics["downloads"][fmt].update({"bit_depth": bits, "sample_rate_hz": rate})
            r.check(f"{fmt.upper()} download arrives intact", body.status_code == 200 and digest_ok and "attachment" in body.headers.get("content-disposition", ""), f"{len(body.content)} bytes{extra}")
        stranger_session, _ = await self.person(admin, "stranger", password)
        stranger = await self.call("POST", "/api/v1/me/downloads", stranger_session["access_token"], json={"track_id": track_id, "format": "flac"})
        r.check("someone who did not buy cannot download", stranger.status_code == 403)

        r.metrics["ids"] = {"release_id": release_id, "track_id": track_id, "version_id": version_id}

    def scan_logs(self) -> None:
        logs = [p for p in (self.out / "api.log", self.out / "worker.log") if p.exists()]
        if not logs:
            self.report.check("staging logs hold no signed links", False, "no log files in var/staging (start api/worker with staging.ps1)")
            return
        text = "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in logs)
        leaked = [s[:12] + "â€¦" for s in self.secrets_seen if s and s in text]
        self.report.check("staging logs hold no signed links", not leaked and "[token]" in text, f"{len(self.secrets_seen)} links checked across {len(logs)} log file(s)")
        exposed = [e for e in self.emails_seen if e in text]
        self.report.check("staging logs hold no account email addresses", not exposed, f"{len(self.emails_seen)} addresses checked; {len(exposed)} found in full")

    def write(self) -> Path:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
        data = {"api": self.api, **self.report.__dict__, "passed": self.report.passed}
        json_path = self.out / f"pilot-{stamp}.json"
        json_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        lines = [f"# Audio pilot {stamp}", "", f"API: {self.api}. Result: **{'PASS' if self.report.passed else 'FAIL'}**", "", "| Check | Result | Detail |", "|---|---|---|"]
        lines += [f"| {c['check']} | {'PASS' if c['ok'] else 'FAIL'} | {c['detail']} |" for c in self.report.checks]
        lines += ["", "## Measurements", "", "```json", json.dumps(self.report.metrics, indent=2), "```"]
        (self.out / f"pilot-{stamp}.md").write_text("\n".join(lines), encoding="utf-8")
        return json_path


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api", default="http://localhost:8010")
    parser.add_argument("--out", default=str(ROOT / "var" / "staging"))
    parser.add_argument("--audio", default=None, help="An authorised, non-sensitive master (WAV/FLAC). Default: an original synthesised piece.")
    args = parser.parse_args()
    if os.environ.get("APP_ENV", "").lower() != "staging":
        print("Refusing to run: APP_ENV is not staging. Use .\\scripts\\staging.ps1 pilot.")
        return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    pilot = Pilot(args.api, out, Path(args.audio) if args.audio else None)
    try:
        await pilot.journey()
    except Exception as exc:  # noqa: BLE001 - recorded as a failed check, then reported
        pilot.report.check("journey completed", False, f"{type(exc).__name__}: {exc}")
    finally:
        await pilot.http.aclose()
    pilot.scan_logs()
    path = pilot.write()
    print(f"\n{'PASS' if pilot.report.passed else 'FAIL'}: report written to {path}")
    return 0 if pilot.report.passed else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
