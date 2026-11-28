"""Which part of Corner Room an audited action belongs to (D-STAFF-ACCOUNTS-01, staff activity).

Audit actions are `<thing>.<what happened>` (e.g. `release.approved`). The staff portal's activity
view groups them by area so an admin can see who did what in Music, Money, Live and so on.
Pure rules, no database.
"""

from __future__ import annotations

ACTIVITY_AREAS: dict[str, tuple[str, ...]] = {
    "Music": (
        "release",
        "release_track",
        "track",
        "track_version",
        "teaser",
        "upload",
        "media",
        "media_job",
        "trending",
        "lyrics",
        "cover",
        "presale",
    ),
    "Artists": ("artist", "band", "band_member", "artist_join_link", "artist_team", "profile_change"),
    "Money": (
        "order",
        "payment",
        "refund",
        "payout",
        "settlement",
        "expense",
        "revenue",
        "recognized_revenue",
        "revenue_pool",
        "royalty",
        "royalty_rule",
        "royalty_rate",
        "royalty_statement",
        "rights",
        "product",
        "offer",
        "price",
        "entitlement",
        "subscription",
        "subscription_plan",
        "journal",
    ),
    "Gifts and emails": (
        "artist_mail",
        "gift_campaign",
        "gift_mail_send",
        "gift_status_mail",
        "music_gift",
        "fan_gift",
    ),
    "Live": ("event", "venue", "ticket", "ticket_type", "ticket_hold", "checkin"),
    "Marketing": ("campaign", "campaign_task"),
    "Accounts": (
        "staff_account",
        "role",
        "resource_grant",
        "user",
        "organization",
        "membership",
        "customer_profile",
        "customer",
        "identity",
    ),
    "Sign-ins": ("auth", "session"),
}

AREA_NAMES = tuple(ACTIVITY_AREAS.keys()) + ("Other",)
_BY_PREFIX = {prefix: area for area, prefixes in ACTIVITY_AREAS.items() for prefix in prefixes}


def area_for(action: str | None) -> str:
    prefix = (action or "").split(".", 1)[0]
    return _BY_PREFIX.get(prefix, "Other")


def prefixes_for(area: str) -> tuple[str, ...]:
    return ACTIVITY_AREAS.get(area, ())
