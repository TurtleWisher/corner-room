"""Who is staff, at what level, and who may change whom (owner, 2026-11-28, D-STAFF-ACCOUNTS-01).

Three levels, all ordinary Corner Room accounts (one person, one account: a fan account that
becomes staff keeps everything it had):

- OWNER: holds `super_admin` for the whole platform (set up by the owner, never from the portal).
- ADMIN: holds `staff_admin` for the whole platform: every staff permission except `role.admin`
  (editing roles themselves stays the owner's). Admins see and run every part of the portal.
- STAFF: holds one or more **areas**, each an existing seeded role, for the whole platform.

Owner's answers (2026-11-28): only the owner adds or removes admins; admins add, change and
remove staff. Nobody changes their own level, and an owner is never changed from the portal.
Staff sign in with Google or a password: it is the same account either way.

Pure rules only: no database here.
"""

from __future__ import annotations

from dataclasses import dataclass

OWNER_ROLE = "super_admin"
ADMIN_ROLE = "staff_admin"

LEVELS = ("OWNER", "ADMIN", "STAFF")
SETTABLE_LEVELS = ("ADMIN", "STAFF")

# Permissions that open the staff accounts page and let someone manage staff (admins and owners).
MANAGE_STAFF_PERMISSION = "user.admin"
# Only owners hold it, so only owners add or remove admins.
MANAGE_ADMINS_PERMISSION = "role.admin"


@dataclass(frozen=True, slots=True)
class Area:
    role_key: str
    label: str
    does: str
    group: str


# The staff areas an admin can give, in the order the portal shows them. Each is an existing role
# (infra/seed.py ROLE_PERMISSIONS); the words say what it opens. `admin` (Administrator) is not
# an area: managing accounts is the Admin level's job.
AREAS: tuple[Area, ...] = (
    Area("content_manager", "Music review", "Approve, release and take down songs and releases.", "Music"),
    Area("catalog_manager", "Catalog help", "Help artists with uploads and fix release details.", "Music"),
    Area("catalog_assistant", "Catalog assistant", "Help artists with uploads (no approving).", "Music"),
    Area("media_operator", "Audio processing", "Watch and retry audio processing jobs.", "Music"),
    Area("label_manager", "Artists and profiles", "Review artist profiles, bands and teams.", "Music"),
    Area("legal", "Takedowns", "Take music down for rights reasons.", "Music"),
    Area("event_manager", "Events", "Create, publish and cancel events.", "Live"),
    Area("ops_manager", "Events and venues", "Run events and venues, and read the audit log.", "Live"),
    Area("checkin_staff", "Door check-in", "Scan tickets at the door.", "Live"),
    Area("venue_partner", "Venues", "Add and edit venues.", "Live"),
    Area(
        "finance_manager",
        "Money and royalties",
        "Check payments, refunds, finance, payouts and royalty rates.",
        "Money",
    ),
    Area("marketing_manager", "Campaigns", "Run marketing campaigns.", "Marketing"),
    Area("analyst", "Analytics", "Read listening, sales and event numbers.", "Insight"),
)

AREA_KEYS = frozenset(a.role_key for a in AREAS)


def level_for(role_keys: set[str] | frozenset[str]) -> str | None:
    """The level a set of platform-wide role keys gives, or None for someone who isn't staff."""
    if OWNER_ROLE in role_keys:
        return "OWNER"
    if ADMIN_ROLE in role_keys:
        return "ADMIN"
    if role_keys & AREA_KEYS:
        return "STAFF"
    return None


def areas_of(role_keys: set[str] | frozenset[str]) -> list[str]:
    """Area role keys held, in the portal's order."""
    return [a.role_key for a in AREAS if a.role_key in role_keys]


def clean_areas(keys: list[str]) -> list[str]:
    """Known area keys only, each once, in the portal's order."""
    wanted = set(keys)
    return [a.role_key for a in AREAS if a.role_key in wanted]


def refusal(
    *,
    viewer_id: object,
    viewer_permissions: frozenset[str] | set[str],
    target_id: object | None,
    current_level: str | None,
    new_level: str | None,
) -> str | None:
    """Why this change isn't allowed (an error code), or None when it is.

    `new_level` None means taking away every staff power. `current_level` None means the person
    isn't staff yet.
    """
    if MANAGE_STAFF_PERMISSION not in viewer_permissions:
        return "NOT_ALLOWED"
    if target_id is not None and target_id == viewer_id:
        return "NOT_YOURSELF"
    if current_level == "OWNER":
        return "OWNER_FIXED"
    if new_level is not None and new_level not in SETTABLE_LEVELS:
        return "BAD_LEVEL"
    touches_admin = current_level == "ADMIN" or new_level == "ADMIN"
    if touches_admin and MANAGE_ADMINS_PERMISSION not in viewer_permissions:
        return "OWNER_ONLY"
    return None


def allowed_levels(viewer_permissions: frozenset[str] | set[str]) -> list[str]:
    """Levels this viewer can give to someone new."""
    if MANAGE_STAFF_PERMISSION not in viewer_permissions:
        return []
    if MANAGE_ADMINS_PERMISSION in viewer_permissions:
        return ["ADMIN", "STAFF"]
    return ["STAFF"]
