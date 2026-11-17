"""Open price (owner, 2026-11-15, D-OPEN-PRICE-01).

An artist can turn on "open price" when proposing the price of a song or release. The price staff
agree to is then the lowest amount for that music, and each buyer chooses what they pay from there
up. Pure rules only: nothing here reads the database or the settings.

The range (owner, 2026-11-17, Q-OPEN-01 and Q-OPEN-02): every open-price amount, the artist's
lowest and the buyer's own, is between `OPEN_PRICE_MIN_MINOR` (৳10) and `OPEN_PRICE_MAX_MINOR`
(৳100,000). Settings, so the owner can move them; 0 turns that end of the range off.
"""

from __future__ import annotations

from cornerroom.infra.errors import AppError

# Who an open price can be for: the normal price only. Pre-sale prices and the price for fans who
# already own part of a release stay fixed.
OPEN_PRICE_AUDIENCES = frozenset({"EVERYONE"})


def assert_can_be_open(*, audience: str, amount_minor: int, min_minor: int = 0, max_minor: int = 0) -> None:
    """A proposal may be an open price only for the normal price, with a lowest amount above zero
    (an order of nothing is a gift, which has its own tool) and inside the range."""
    if audience not in OPEN_PRICE_AUDIENCES:
        raise AppError("VALIDATION_ERROR", "Open price is for the normal price only", 422)
    if amount_minor <= 0:
        raise AppError("VALIDATION_ERROR", "Set the lowest amount a buyer can pay", 422)
    if min_minor > 0 and amount_minor < min_minor:
        raise AppError(
            "AMOUNT_TOO_LOW", "The lowest amount is below the open price range", 422,
            extras={"min_minor": min_minor},
        )
    if max_minor > 0 and amount_minor > max_minor:
        raise AppError(
            "AMOUNT_TOO_HIGH", "The lowest amount is above the open price range", 422,
            extras={"max_minor": max_minor},
        )


def amount_to_charge(
    *, lowest_minor: int, open_price: bool, chosen_minor: int | None, min_minor: int = 0, max_minor: int = 0
) -> int:
    """The amount an order is placed for.

    A buyer who sends their own amount for a fixed price is refused, so a page can never talk the
    server into another total. With an open price, no chosen amount means the lowest one; a chosen
    amount must be at least the artist's lowest and inside the range.
    """
    if not open_price:
        if chosen_minor is not None and chosen_minor != lowest_minor:
            raise AppError("PRICE_IS_FIXED", "This price can't be changed", 422)
        return lowest_minor
    floor = max(lowest_minor, min_minor)
    amount = floor if chosen_minor is None else chosen_minor
    if amount < floor:
        raise AppError(
            "AMOUNT_TOO_LOW", "That is less than the lowest amount for this music", 422,
            extras={"min_minor": floor},
        )
    if max_minor > 0 and amount > max_minor:
        raise AppError(
            "AMOUNT_TOO_HIGH", "That is more than can be paid for this music", 422,
            extras={"max_minor": max_minor},
        )
    return amount
