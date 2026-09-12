"""Search visibility and sensitive-text exclusion. Guest query policy is API-later."""

from __future__ import annotations

from uuid import UUID

VISIBILITY_PUBLIC = "PUBLIC"
VISIBILITY_STAFF_ORG = "STAFF_ORG"
VISIBILITY_UNAVAILABLE = "UNAVAILABLE"

ENTITY_ARTIST = "ARTIST"
ENTITY_BAND = "BAND"
ENTITY_RELEASE = "RELEASE"
ENTITY_TRACK = "TRACK"
ENTITY_EVENT = "EVENT"
ENTITY_VENUE = "VENUE"
ENTITY_CAMPAIGN = "CAMPAIGN"
ENTITY_USER = "USER"
ENTITY_ORGANIZATION = "ORGANIZATION"

GUEST_ENTITY_TYPES = frozenset(
    {ENTITY_ARTIST, ENTITY_BAND, ENTITY_EVENT, ENTITY_TRACK, ENTITY_RELEASE}
)
SCHEMA_ENTITY_TYPES = frozenset(
    {
        ENTITY_ARTIST,
        ENTITY_BAND,
        ENTITY_RELEASE,
        ENTITY_TRACK,
        ENTITY_EVENT,
        ENTITY_VENUE,
        ENTITY_CAMPAIGN,
        ENTITY_USER,
        ENTITY_ORGANIZATION,
    }
)

# Public/staff HTTP route metadata (04_). Not a frontend implementation.
ENTITY_ROUTES = {
    ENTITY_ARTIST: "/artists/{id}",
    ENTITY_BAND: "/bands/{id}",
    ENTITY_EVENT: "/events/{id}",
    ENTITY_TRACK: "/tracks/{id}",
    ENTITY_RELEASE: "/releases/{id}",
    ENTITY_VENUE: "/venues/{id}",
    ENTITY_CAMPAIGN: "/campaigns/{id}",
}

# STAFF_ORG extra hits: AuthorizationService on owning resource. Visibility is not authz.
# Campaigns have no campaign.read (Q-P12-01) — campaign.write until decided.
STAFF_HIT_AUTHZ: dict[str, tuple[str, str]] = {
    ENTITY_ARTIST: ("artist", "analytics.read"),
    ENTITY_BAND: ("band", "artist.manage"),
    ENTITY_EVENT: ("event", "event.read"),
    ENTITY_TRACK: ("track", "analytics.read"),
    ENTITY_RELEASE: ("release", "analytics.read"),
    ENTITY_VENUE: ("venue", "venue.read"),
    ENTITY_CAMPAIGN: ("campaign", "campaign.write"),
}

SENSITIVE_FRAGMENTS = (
    "password",
    "secret",
    "token",
    "kyc",
    "pan",
    "amount_minor",
    "currency_code",
    "share_bps",
    "legal_name",
    "qr_secret",
    "iban",
    "nid",
)


def visibility_public_or_unavailable(is_public: bool) -> str:
    return VISIBILITY_PUBLIC if is_public else VISIBILITY_UNAVAILABLE


def route_for(entity_type: str, entity_id: UUID) -> str | None:
    template = ENTITY_ROUTES.get(entity_type)
    if template is None:
        return None
    return template.replace("{id}", str(entity_id))


def snippet_for(title: str, searchable_text: str, *, limit: int = 240) -> str:
    text = (searchable_text or title or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit]


def exclude_sensitive(text: str) -> str:
    lowered = text.lower()
    for fragment in SENSITIVE_FRAGMENTS:
        if fragment in lowered:
            return ""
    return text


def build_searchable_text(*parts: str | None) -> str:
    cleaned: list[str] = []
    for part in parts:
        if not part:
            continue
        piece = exclude_sensitive(part.strip())
        if piece:
            cleaned.append(piece)
    return " ".join(cleaned)
