"""Foundation seed: permissions, roles, PLATFORM + LABEL orgs. Idempotent."""

from __future__ import annotations

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cornerroom.infra.logging import mask_email
from cornerroom.infra.security import hash_password
from cornerroom.infra.settings import Settings
from cornerroom.modules.authorization.domain.models import (
    FOUNDATION_PERMISSIONS,
    Permission,
    Role,
    RoleAssignment,
    RolePermission,
)
from cornerroom.modules.identity.domain.models import Organization, User
from cornerroom.modules.music.domain.models import CreditRole, Genre, RenditionProfile
from cornerroom.modules.notifications.domain.models import NotificationTemplate

log = structlog.get_logger("seed")

ROLE_PERMISSIONS: dict[str, tuple[str, tuple[str, ...]]] = {
    "customer": ("Customer", ()),
    "artist": ("Artist", ()),
    "artist_manager": ("Artist Manager", ()),
    "band_member": ("Band Member", ()),
    "event_manager": (
        "Event Manager",
        ("event.read", "event.write", "event.publish", "event.cancel", "venue.read"),
    ),
    "marketing_manager": ("Marketing Manager", ("campaign.write", "event.read")),
    "finance_manager": (
        "Finance Manager",
        (
            "finance.read",
            "finance.post",
            "finance.payout_approve",
            "commerce.write",
            "commerce.grant",
            "royalty.read",
            "royalty.run",
        ),
    ),
    "content_manager": (
        "Content Manager",
        ("music.write", "music.approve", "music.takedown"),
    ),
    "label_manager": ("Label Manager", ("artist.manage", "music.write")),
    "ops_manager": (
        "Operations Manager",
        (
            "event.read",
            "event.write",
            "event.publish",
            "event.cancel",
            "venue.read",
            "venue.write",
            "audit.read",
        ),
    ),
    "checkin_staff": ("Check-in Staff", ("event.read", "ticket.checkin")),
    "support": ("Support", ()),
    "analyst": ("Analyst", ("analytics.read",)),
    "legal": ("Legal", ("music.takedown",)),
    "admin": ("Administrator", ("user.admin", "org.admin", "audit.read")),
    "super_admin": ("Super Admin", FOUNDATION_PERMISSIONS),
    "venue_partner": ("Venue Partner", ("venue.read", "venue.write")),
    "sponsor": ("Sponsor", ()),
    "producer": ("Producer", ()),
    "songwriter": ("Songwriter", ()),
    # Audio platform roles (S5); the owner assigns people.
    "catalog_assistant": ("Catalog Assistant", ("music.intake_assist",)),
    "catalog_manager": ("Catalog Manager", ("music.intake_assist", "music.intake_manage")),
    "media_operator": ("Media Operator", ("media.ops",)),
}

# Playback copy recipes (D-AUDIO-03). CANDIDATE until the blind listening comparison sets the
# final bitrates; seeded once, never overwritten here.
# Credit vocabulary (D-AUDIO-16). Performer roles link to an Artist; the rest may be a typed name.
CREDIT_ROLES = (
    ("primary_artist", "Primary artist", "প্রধান শিল্পী", True, False),
    ("featured_artist", "Featured artist", "অতিথি শিল্পী", True, False),
    ("performer", "Performer", "পরিবেশক", True, True),
    ("remixer", "Remixer", "রিমিক্সার", False, False),
    ("producer", "Producer", "প্রযোজক", False, False),
    ("songwriter", "Songwriter", "গীতিকার ও সুরকার", False, False),
    ("composer", "Composer", "সুরকার", False, False),
    ("lyricist", "Lyricist", "গীতিকার", False, False),
    ("arranger", "Arranger", "সংগীত আয়োজক", False, False),
    ("mixing_engineer", "Mixing engineer", "মিক্সিং প্রকৌশলী", False, False),
    ("mastering_engineer", "Mastering engineer", "মাস্টারিং প্রকৌশলী", False, False),
)

# Genre list approved with the design (S10). Data: staff can retire or add rows later.
GENRES = (
    ("bangla_folk", "Bangla Folk", "বাংলা লোকগীতি"),
    ("baul", "Baul", "বাউল"),
    ("rabindra_sangeet", "Rabindra Sangeet", "রবীন্দ্রসংগীত"),
    ("nazrul_geeti", "Nazrul Geeti", "নজরুলগীতি"),
    ("lalon_geeti", "Lalon Geeti", "লালনগীতি"),
    ("adhunik", "Adhunik", "আধুনিক"),
    ("bangla_rock", "Bangla Rock / Band", "বাংলা রক / ব্যান্ড"),
    ("bangla_hiphop", "Bangla Hip-Hop", "বাংলা হিপহপ"),
    ("bangla_pop", "Bangla Pop", "বাংলা পপ"),
    ("film_music", "Film Music (Dhallywood)", "চলচ্চিত্রের গান"),
    ("devotional", "Islamic / Devotional", "ইসলামি / ভক্তিমূলক"),
    ("pop", "Pop", "পপ"),
    ("rock", "Rock", "রক"),
    ("indie", "Alternative / Indie", "অল্টারনেটিভ / ইন্ডি"),
    ("hiphop", "Hip-Hop / Rap", "হিপহপ / র‍্যাপ"),
    ("rnb_soul", "R&B / Soul", "আর অ্যান্ড বি / সোল"),
    ("electronic", "Electronic / Dance", "ইলেকট্রনিক / ড্যান্স"),
    ("jazz", "Jazz", "জ্যাজ"),
    ("blues", "Blues", "ব্লুজ"),
    ("classical_western", "Classical (Western)", "পাশ্চাত্য ধ্রুপদী"),
    ("hindustani_classical", "Hindustani Classical", "উচ্চাঙ্গসংগীত"),
    ("world", "World", "ওয়ার্ল্ড"),
    ("metal", "Metal", "মেটাল"),
    ("soundtrack", "Soundtrack / Score", "সাউন্ডট্র্যাক"),
    ("ambient", "Ambient", "অ্যাম্বিয়েন্ট"),
    ("lofi", "Lo-fi", "লো-ফাই"),
    ("acoustic", "Acoustic / Singer-songwriter", "অ্যাকুস্টিক"),
    ("childrens", "Children's", "শিশুতোষ"),
    ("spoken_word", "Spoken word", "আবৃত্তি"),
)

RENDITION_PROFILES = (
    {"key": "opus_hq", "codec": "opus", "container": "ogg", "bitrate_kbps": 160, "sample_rate_hz": 48000, "sort": 1},
    {"key": "mp3_compat", "codec": "mp3", "container": "mp3", "bitrate_kbps": 320, "sample_rate_hz": 44100, "sort": 2},
    # D-AUDIO-06: the buyer's lossless download. Rate and bit depth stay as the master's (0 = as
    # master), so there is no bitrate to choose by listening test: ACTIVE from the start. The MP3
    # download is the mp3_compat playback copy above (MP3 320).
    {"key": "flac_download", "codec": "flac", "container": "flac", "bitrate_kbps": 0, "sample_rate_hz": 0, "sort": 3,
     "purpose": "DOWNLOAD", "status": "ACTIVE"},
)

SEED_ORGS = (
    ("PLATFORM", "Corner Room Platform"),
    ("LABEL", "Corner Room Label"),
)


async def seed_foundation(session: AsyncSession, settings: Settings) -> None:
    perms: dict[str, Permission] = {}
    for key in FOUNDATION_PERMISSIONS:
        row = (
            await session.execute(select(Permission).where(Permission.key == key))
        ).scalar_one_or_none()
        if row is None:
            row = Permission(key=key, description=key)
            session.add(row)
            await session.flush()
        perms[key] = row

    roles: dict[str, Role] = {}
    for key, (name, perm_keys) in ROLE_PERMISSIONS.items():
        role = (await session.execute(select(Role).where(Role.key == key))).scalar_one_or_none()
        if role is None:
            role = Role(key=key, name=name, status="ACTIVE")
            session.add(role)
            await session.flush()
        roles[key] = role
        for perm_key in perm_keys:
            existing = await session.get(RolePermission, (role.id, perms[perm_key].id))
            if existing is None:
                session.add(RolePermission(role_id=role.id, permission_id=perms[perm_key].id))

    for sort, (key, label_en, label_bn, performer, instrument) in enumerate(CREDIT_ROLES):
        if await session.get(CreditRole, key) is None:
            session.add(CreditRole(key=key, label_en=label_en, label_bn=label_bn, performer=performer, allows_instrument=instrument, sort=sort))
    for sort, (key, label_en, label_bn) in enumerate(GENRES):
        if await session.get(Genre, key) is None:
            session.add(Genre(key=key, label_en=label_en, label_bn=label_bn, status="ACTIVE", sort=sort))

    for spec in RENDITION_PROFILES:
        if await session.get(RenditionProfile, spec["key"]) is None:
            session.add(
                RenditionProfile(**{"status": "CANDIDATE", "purpose": "PLAYBACK", **spec}, channels=2, profile_version=1, required=True)
            )

    for org_type, name in SEED_ORGS:
        found = (
            await session.execute(
                select(Organization).where(
                    Organization.type == org_type,
                    Organization.name == name,
                    Organization.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if found is None:
            session.add(Organization(type=org_type, name=name, status="ACTIVE"))

    welcome = (
        await session.execute(
            select(NotificationTemplate).where(
                NotificationTemplate.type == "user.registered",
                NotificationTemplate.locale == "en",
            )
        )
    ).scalar_one_or_none()
    if welcome is None:
        session.add(
            NotificationTemplate(
                type="user.registered",
                locale="en",
                version=1,
                body="Welcome to Corner Room. Your account was created and may require verification before sign-in.",
            )
        )

    invite_tpl = (
        await session.execute(
            select(NotificationTemplate).where(
                NotificationTemplate.type == "organization.invitation_issued",
                NotificationTemplate.locale == "en",
            )
        )
    ).scalar_one_or_none()
    if invite_tpl is None:
        session.add(
            NotificationTemplate(
                type="organization.invitation_issued",
                locale="en",
                version=1,
                body="You were invited to a Corner Room organization. Delivery of this message is event-driven; no email provider is configured in this phase.",
            )
        )

    for ntype, body in (
        ("entitlement.granted", "A commercial entitlement is now active on your account."),
        ("subscription.started", "Your subscription is active for the current period."),
        ("subscription.cancelled", "Your subscription is cancelled. Access continues until the current period ends."),
        ("royalty.statement_issued", "A royalty statement is available."),
        ("royalty.statement_adjusted", "A royalty statement was adjusted."),
        ("campaign.task_assigned", "A campaign task was assigned to you."),
        ("campaign.task_completed", "A campaign task was completed."),
        ("ticket.issued", "Your ticket was issued."),
        ("order.paid", "Your order was paid."),
        ("order.cancelled", "Your reservation ran out before your payment was confirmed, so your order was cancelled. If money already left your account, our team will refund it in full."),
        ("payment.failed", "A payment attempt failed."),
        ("payment.rejected", "We couldn't confirm your payment: {reason}. Please check the details and send them again from your order."),
        ("refund.completed", "Your refund is complete."),
        ("track.approved", "A track was approved."),
        ("track.released", "A track was released."),
        ("settlement.completed", "A settlement was completed."),
        ("payout.completed", "A payout was completed."),
        ("payout.failed", "A payout failed."),
        ("subscription.past_due", "Your subscription is past due."),
        ("password.changed", "Your password was changed."),
        ("account.locked", "Your account was locked."),
        ("refresh_token.replay_detected", "A sign-in token was reused. Sessions in that family were revoked."),
    ):
        found = (
            await session.execute(
                select(NotificationTemplate).where(
                    NotificationTemplate.type == ntype,
                    NotificationTemplate.locale == "en",
                )
            )
        ).scalar_one_or_none()
        if found is None:
            session.add(
                NotificationTemplate(type=ntype, locale="en", version=1, body=body)
            )

    # D-REF-01 (owner, 2026-10-18): platform refund reasons; each needs a finance approval
    # (Q-P0-05). The label lives in `notes` so screens show words, not codes.
    from cornerroom.modules.ticketing.domain.models import RefundPolicy

    for reason_code, label in (
        ("CUSTOMER_REQUEST", "Customer request"),
        ("EVENT_CANCELLED", "Event cancelled"),
        ("EVENT_POSTPONED", "Event postponed, buyer can't attend"),
        ("LATE_PAYMENT", "Payment arrived late, order cancelled"),
        ("DUPLICATE_PAYMENT", "Duplicate payment"),
        ("GOODWILL", "Goodwill / service issue"),
    ):
        found = (
            await session.execute(
                select(RefundPolicy).where(
                    RefundPolicy.scope_type == "PLATFORM",
                    RefundPolicy.scope_id.is_(None),
                    RefundPolicy.reason_code == reason_code,
                )
            )
        ).scalars().first()
        if found is None:
            session.add(
                RefundPolicy(scope_type="PLATFORM", reason_code=reason_code, requires_finance_approve=True, notes=label)
            )

    if settings.bootstrap_admin_email and settings.bootstrap_admin_password:
        email = settings.bootstrap_admin_email.strip().lower()
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            user = User(
                email=email,
                password_hash=hash_password(settings.bootstrap_admin_password),
                status="ACTIVE",
            )
            session.add(user)
            await session.flush()
            session.add(
                RoleAssignment(
                    user_id=user.id,
                    role_id=roles["super_admin"].id,
                    organization_id=None,
                    status="ACTIVE",
                )
            )
            log.info("bootstrap_admin_created", email=mask_email(email))

    await session.flush()
    log.info("foundation_seeded")
