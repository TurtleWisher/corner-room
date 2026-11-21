"""Collectible notes say "collectible", not "gift". Data only, additive.

Revision ID: 0065_collectible_notes
Revises: 0064_test_orders
Create Date: 2026-11-21

Owner, 2026-11-21: an artist's gift campaign is called a collectible everywhere, on fan pages,
in Studio, for staff and in every email and note. This adds a newer version of the dispatched,
returned and missing note templates with the new word; the newest version is the one used, and
the old rows stay as they were (as in 0063).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0065_collectible_notes"
down_revision: Union[str, Sequence[str], None] = "0064_test_orders"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BODIES = {
    "gift.dispatched": (
        "Good news from {artist}: a collectible for buying {music} is on its way to you. It should reach you in the "
        "next few days."
    ),
    "gift.returned": (
        "Your collectible from {artist}, for buying {music}, couldn't be delivered and came back. Please check that the "
        "delivery address in your Corner Room account is correct. Once your address is right, it will be sent again. "
        "We'll email you again when there's news."
    ),
    "gift.missing": (
        "Your collectible from {artist}, for buying {music}, hasn't arrived yet. We're finding out where it is and will "
        "email you as soon as we know more. If it doesn't turn up, we'll send another. You don't need to do anything "
        "for now."
    ),
}


def upgrade() -> None:
    bind = op.get_bind()
    for ntype, body in BODIES.items():
        # One newer version per type and locale that already has the template; fresh databases get
        # the new words from the seed instead.
        bind.execute(
            sa.text(
                "INSERT INTO notifications.notification_templates (id, type, locale, version, body, created_at, updated_at) "
                "SELECT gen_random_uuid(), type, locale, max(version) + 1, :body, now(), now() "
                "FROM notifications.notification_templates WHERE type = :type GROUP BY type, locale"
            ),
            {"type": ntype, "body": body},
        )


def downgrade() -> None:
    bind = op.get_bind()
    for ntype, body in BODIES.items():
        bind.execute(
            sa.text("DELETE FROM notifications.notification_templates WHERE type = :type AND body = :body AND version > 1"),
            {"type": ntype, "body": body},
        )
