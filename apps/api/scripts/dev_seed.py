"""Local demo data for the Corner Room dev stack (OD-28). Dev only, idempotent.

Builds a small, clearly fictional graph so every public and staff page has something real to show:
a venue and three events (on sale, announced, postponed) with ticket types, artists and a band,
released releases and tracks with durations, track and catalog offers, a subscription plan, a staff
user and a fan. Rows are inserted through the backend's own models, the same fixture shortcut the
Phase 13 test graph uses (tests/integration/phase13/graph.py); nothing here is a business rule.
Prices are demo values only.

Run from apps/api with the env loaded (scripts/dev-stack.ps1 -Seed does this):
    python scripts/dev_seed.py
    python scripts/dev_seed.py --customer someone@example.com   # one more empty customer

Passwords come from the environment (DEMO_STAFF_PASSWORD, DEMO_FAN_PASSWORD), never from code.
Refuses to run unless APP_ENV is local or dev.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import math
import struct
import wave
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sqlalchemy import select  # noqa: E402

import cornerroom.infra.models  # noqa: E402,F401  (registers every ORM model)
from cornerroom.infra.db import get_session_factory  # noqa: E402
from cornerroom.infra.security import hash_password  # noqa: E402
from cornerroom.infra.seed import seed_foundation  # noqa: E402
from cornerroom.infra.settings import get_settings  # noqa: E402
from cornerroom.infra.storage import get_storage  # noqa: E402
from cornerroom.modules.documents.domain.models import MediaAsset  # noqa: E402
from cornerroom.modules.search.application.indexer import SearchIndexer  # noqa: E402
from cornerroom.modules.artists.domain.models import Artist, Band, BandMember  # noqa: E402
from cornerroom.modules.authorization.domain.models import Role, RoleAssignment  # noqa: E402
from cornerroom.modules.commerce.domain.models import Offer, Product  # noqa: E402
from cornerroom.modules.events.domain.models import Event, Venue  # noqa: E402
from cornerroom.modules.identity.domain.models import (  # noqa: E402
    CustomerProfile,
    Organization,
    OrganizationMembership,
    User,
)
from cornerroom.modules.music.domain.models import Release, ReleaseTrack, Track, TrackVersion  # noqa: E402
from cornerroom.modules.subscriptions.domain.models import (  # noqa: E402
    SubscriptionPlan,
    SubscriptionPlanVersion,
)
from cornerroom.modules.ticketing.domain.models import TicketType, TicketTypeInventory  # noqa: E402

STAFF_EMAIL = "ops.demo@example.com"
FAN_EMAIL = "fan.demo@example.com"
# A second customer who owns nothing, for testing the buying flow from scratch.
NEW_FAN_EMAIL = "newfan.demo@example.com"
ZONE = "Asia/Dhaka"
BDT = "BDT"
# Unscoped staff roles: API staff gates count unscoped assignments only (Phase 15 Gate 1, finding 6).
STAFF_ROLES = ("ops_manager", "finance_manager", "marketing_manager", "analyst", "label_manager", "admin")


def _at(days: int, hour: int) -> datetime:
    """Local Dhaka evening `days` from today, stored in UTC (Dhaka is UTC+6, no DST)."""
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return today + timedelta(days=days, hours=hour - 6)


async def _user(session, email: str, password: str, name: str) -> User:
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = User(email=email, password_hash=hash_password(password), status="ACTIVE")
        session.add(user)
        await session.flush()
    profile = (await session.execute(select(CustomerProfile).where(CustomerProfile.user_id == user.id))).scalar_one_or_none()
    if profile is None:
        session.add(CustomerProfile(user_id=user.id, display_name=name, status="ACTIVE", locale="en"))
    else:
        profile.display_name = profile.display_name or name
    return user


async def _role(session, user: User, key: str) -> None:
    role = (await session.execute(select(Role).where(Role.key == key))).scalar_one()
    exists = (
        await session.execute(
            select(RoleAssignment).where(
                RoleAssignment.user_id == user.id,
                RoleAssignment.role_id == role.id,
                RoleAssignment.organization_id.is_(None),
            )
        )
    ).scalar_one_or_none()
    if exists is None:
        session.add(RoleAssignment(user_id=user.id, role_id=role.id, status="ACTIVE"))


async def _member(session, user: User, org: Organization) -> None:
    exists = (
        await session.execute(
            select(OrganizationMembership).where(
                OrganizationMembership.user_id == user.id,
                OrganizationMembership.organization_id == org.id,
            )
        )
    ).scalar_one_or_none()
    if exists is None:
        session.add(OrganizationMembership(organization_id=org.id, user_id=user.id, status="ACTIVE"))


def _demo_tone(seed: str, seconds: int = 20, rate: int = 16000) -> bytes:
    """A short, obviously synthetic two-note tone (WAV) so demo playback has real audio.
    Local fixture only (STORAGE_ARCHITECTURE allows local/staging fixtures; Q-P0-12 still gates real masters)."""
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:6], 16)
    f1, f2 = 196 + h % 196, 330 + (h // 7) % 220
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(seconds * rate):
            t = i / rate
            env = min(1.0, t * 4, (seconds - t) * 4)
            v = 0.18 * env * (math.sin(2 * math.pi * f1 * t) + 0.6 * math.sin(2 * math.pi * f2 * t * (1 + (int(t) % 2) * 0.12)))
            frames += struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767))
        w.writeframes(bytes(frames))
    return buf.getvalue()


async def _ensure_demo_audio(session, settings) -> int:
    """Give every demo master without media a READY catalog_audio asset. Idempotent."""
    storage = get_storage(settings)
    versions = (
        await session.execute(
            select(TrackVersion).where(TrackVersion.media_asset_id.is_(None), TrackVersion.status == "READY", TrackVersion.is_current.is_(True))
        )
    ).scalars().all()
    for version in versions:
        data = _demo_tone(str(version.track_id))
        key = f"catalog_audio/demo/{version.track_id}.wav"
        stored = await storage.put(object_key=key, data=data, mime="audio/wav", storage_class="catalog_audio")
        asset = MediaAsset(storage_class="catalog_audio", bucket=stored.bucket, object_key=key, mime="audio/wav",
                           byte_size=stored.byte_size, sha256=stored.sha256, status="READY", scan_status="SKIPPED_LOCAL")
        session.add(asset)
        await session.flush()
        version.media_asset_id = asset.id
    return len(versions)


async def main() -> None:
    settings = get_settings()
    if settings.app_env not in ("local", "dev"):
        raise SystemExit(f"dev_seed refuses to run with APP_ENV={settings.app_env!r}")
    staff_pw = os.environ.get("DEMO_STAFF_PASSWORD")
    fan_pw = os.environ.get("DEMO_FAN_PASSWORD")
    if not staff_pw or not fan_pw:
        raise SystemExit("Set DEMO_STAFF_PASSWORD and DEMO_FAN_PASSWORD (see .env.seed.local)")

    factory = get_session_factory()
    async with factory() as session, session.begin():
        await seed_foundation(session, settings)
        label = (await session.execute(select(Organization).where(Organization.type == "LABEL"))).scalars().first()
        platform = (await session.execute(select(Organization).where(Organization.type == "PLATFORM"))).scalars().first()
        assert label and platform

        staff = await _user(session, STAFF_EMAIL, staff_pw, "Tanvir Ops")
        fan = await _user(session, FAN_EMAIL, fan_pw, "Nadia Rahman")
        new_fan = await _user(session, NEW_FAN_EMAIL, fan_pw, "Rafi Hasan")
        for key in STAFF_ROLES:
            await _role(session, staff, key)
        await _role(session, fan, "customer")
        await _role(session, new_fan, "customer")
        await _member(session, staff, label)
        await _member(session, staff, platform)
        if settings.bootstrap_admin_email:
            admin = (await session.execute(select(User).where(User.email == settings.bootstrap_admin_email.lower()))).scalar_one_or_none()
            if admin:
                await _member(session, admin, label)
                await _member(session, admin, platform)

        if (await session.execute(select(Event).where(Event.title == "Low Tide"))).scalar_one_or_none():
            added = await _ensure_demo_audio(session, settings)
            indexed = await SearchIndexer(session).rebuild()
            print(f"Demo catalog already present; users and roles refreshed; demo audio added to {added} tracks; {indexed} search entries rebuilt.")
            return

        # ---- Live: venue, events, ticket types ----
        venue = Venue(organization_id=label.id, name="The Corner Room Stage", status="ACTIVE", capacity=400,
                      address={"city": "Dhaka", "line1": "Demo address"})
        session.add(venue)
        await session.flush()

        low_tide = Event(organization_id=label.id, venue_id=venue.id, title="Low Tide",
                         description="A late set of slow, heavy electronic music by the water.",
                         status="TICKETING_OPEN", timezone=ZONE, starts_at=_at(6, 20), ends_at=_at(6, 23),
                         published_at=_at(-7, 12))
        night_bus = Event(organization_id=label.id, venue_id=venue.id, title="Night Bus",
                          description="Kaal Bela play the Night Bus EP live, start to finish.",
                          status="PUBLISHED", timezone=ZONE, starts_at=_at(14, 19) + timedelta(minutes=30),
                          ends_at=_at(14, 22), published_at=_at(-2, 12))
        monsoon = Event(organization_id=label.id, venue_id=venue.id, title="Monsoon Frequencies",
                        description="An evening of rain-season songs.", status="POSTPONED", timezone=ZONE,
                        starts_at=_at(26, 21), ends_at=_at(26, 23), previous_starts_at=_at(9, 21),
                        postponement_reason="Moved to a later date because of the weather.",
                        published_at=_at(-10, 12), postponed_at=_at(-1, 12))
        session.add_all([low_tide, night_bus, monsoon])
        await session.flush()

        for event, name, price, qty in (
            (low_tide, "General admission", 150000, 300),
            (low_tide, "Early entry", 250000, 60),
        ):
            tt = TicketType(event_id=event.id, name=name, status="ON_SALE", price_amount_minor=price,
                            currency_code=BDT, quantity_total=qty, sales_starts_at=_at(-7, 12), sales_ends_at=_at(6, 18))
            session.add(tt)
            await session.flush()
            session.add(TicketTypeInventory(ticket_type_id=tt.id, remaining=qty))

        # ---- Label: artists, band, releases, tracks ----
        rumi = Artist(stage_name="Rumi", bio="Dhaka producer working with slow tempos and field recordings.",
                      status="ACTIVE", primary_org_id=label.id)
        mitul = Artist(stage_name="Mitul", bio="Singer and guitarist.", status="ACTIVE", primary_org_id=label.id)
        session.add_all([rumi, mitul])
        await session.flush()
        kaal = Band(name="Kaal Bela", bio="Four-piece band from Dhaka.", status="ACTIVE", primary_org_id=label.id)
        session.add(kaal)
        await session.flush()
        session.add(BandMember(band_id=kaal.id, artist_id=mitul.id, status="ACTIVE", role_label="vocals"))

        catalog = [
            ("Night Bus", "EP", None, kaal, 20, [("Last Stop", 214_000), ("Night Bus", 247_000), ("Farmgate", 198_000),
                                                 ("Sodium Light", 263_000), ("Home Late", 231_000)]),
            ("Low Tide", "SINGLE", rumi, None, 45, [("Low Tide", 305_000), ("Low Tide (Dub)", 342_000)]),
            ("Monsoon Frequencies", "ALBUM", rumi, None, 90, [("First Rain", 188_000), ("Tin Roof", 221_000),
                                                             ("Wet Asphalt", 256_000), ("Kalbaishakhi", 279_000),
                                                             ("After the Storm", 312_000), ("Dry Season", 240_000)]),
            ("Kolkata Sessions", "LIVE", None, kaal, 140, [("Sodium Light (Live)", 301_000), ("Farmgate (Live)", 226_000)]),
        ]
        first_track = None
        tracks_by_title = {}
        releases = []
        for title, rtype, artist, band, days_ago, tracks in catalog:
            rel = Release(release_type=rtype, title=title, status="RELEASED", primary_org_id=label.id,
                          primary_artist_id=artist.id if artist else None, primary_band_id=band.id if band else None,
                          release_at=datetime.now(timezone.utc) - timedelta(days=days_ago))
            session.add(rel)
            await session.flush()
            releases.append(rel)
            for pos, (ttitle, ms) in enumerate(tracks, start=1):
                tr = Track(title=ttitle, status="RELEASED", primary_org_id=label.id,
                           primary_artist_id=artist.id if artist else None, primary_band_id=band.id if band else None)
                session.add(tr)
                await session.flush()
                session.add(TrackVersion(track_id=tr.id, version_type="MASTER", status="READY", is_current=True, duration_ms=ms))
                session.add(ReleaseTrack(release_id=rel.id, track_id=tr.id, position=pos))
                first_track = first_track or tr
                tracks_by_title.setdefault(ttitle, tr)

        # ---- Store: offers and a plan (demo prices) ----
        for ptype, subject, name, amount in (
            ("TRACK", first_track.id, "Last Stop", 5000),
            ("TRACK", tracks_by_title["Low Tide"].id, "Low Tide", 5000),
            # CATALOG_ACCESS grants the whole catalog (entitlement scope CATALOG), so name it that.
            ("CATALOG_ACCESS", releases[2].id, "Full catalog", 45000),
        ):
            product = Product(organization_id=label.id, product_type=ptype, subject_id=subject, name=name, status="ACTIVE")
            session.add(product)
            await session.flush()
            session.add(Offer(organization_id=label.id, product_id=product.id, amount_minor=amount, currency_code=BDT, status="ACTIVE"))

        plan = SubscriptionPlan(organization_id=label.id, key="listener_monthly", status="ACTIVE",
                                price_amount_minor=19900, currency_code=BDT, interval="month", interval_count=1)
        session.add(plan)
        await session.flush()
        pv = SubscriptionPlanVersion(plan_id=plan.id, version_number=1, price_amount_minor=19900, currency_code=BDT,
                                     interval="month", interval_count=1, trial_days=7)
        session.add(pv)
        await session.flush()
        plan.current_version_id = pv.id
        await session.flush()
        await _ensure_demo_audio(session, settings)
        # Rows above were inserted directly (no domain events), so rebuild the search projection.
        await SearchIndexer(session).rebuild()

    print("Demo data created. Sign in as", STAFF_EMAIL, "(staff) or", FAN_EMAIL, "(fan); passwords are in .env.seed.local.")


async def add_customer(email: str) -> None:
    """Create one more empty demo customer (for testing purchases from scratch)."""
    settings = get_settings()
    if settings.app_env not in ("local", "dev"):
        raise SystemExit(f"dev_seed refuses to run with APP_ENV={settings.app_env!r}")
    pw = os.environ.get("DEMO_FAN_PASSWORD")
    if not pw:
        raise SystemExit("Set DEMO_FAN_PASSWORD (see .env.seed.local)")
    async with get_session_factory()() as session, session.begin():
        user = await _user(session, email.lower(), pw, "Demo Customer")
        await _role(session, user, "customer")
    print("Customer ready:", email.lower())


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--customer":
        asyncio.run(add_customer(sys.argv[2]))
    else:
        asyncio.run(main())
