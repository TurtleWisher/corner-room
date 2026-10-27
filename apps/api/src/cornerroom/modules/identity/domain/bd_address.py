"""Delivery addresses and phone numbers (D-ADDR-01, D-ADDR-02). Pure rules, no I/O.

Owner, 2026-10-27 (D-ADDR-02): an address can be anywhere in the world, the buyer's own or a gift
destination, and phone numbers carry their country code. A Bangladesh address keeps its own shape:
division and district from Bangladesh's official list (8 divisions, 64 districts), typed
upazila/thana, area and house/road, and a Bangladesh mobile for the courier. Elsewhere it is the
usual international shape: two address lines, city, state/province/region and postal code.
Phones are stored in international (E.164) form, like +8801712345678 or +447700900123.
"""

from __future__ import annotations

import re

from cornerroom.infra.errors import AppError
from cornerroom.modules.identity.domain.countries import (
    BY_CODE,
    COUNTRIES,
    KEEP_LEADING_ZERO,
    MAIN_FOR_CODE,
    calling_code,
)

DIVISIONS: dict[str, tuple[str, ...]] = {
    "Barishal": ("Barguna", "Barishal", "Bhola", "Jhalokati", "Patuakhali", "Pirojpur"),
    "Chattogram": (
        "Bandarban", "Brahmanbaria", "Chandpur", "Chattogram", "Cox's Bazar", "Cumilla", "Feni",
        "Khagrachhari", "Lakshmipur", "Noakhali", "Rangamati",
    ),
    "Dhaka": (
        "Dhaka", "Faridpur", "Gazipur", "Gopalganj", "Kishoreganj", "Madaripur", "Manikganj",
        "Munshiganj", "Narayanganj", "Narsingdi", "Rajbari", "Shariatpur", "Tangail",
    ),
    "Khulna": (
        "Bagerhat", "Chuadanga", "Jashore", "Jhenaidah", "Khulna", "Kushtia", "Magura", "Meherpur",
        "Narail", "Satkhira",
    ),
    "Mymensingh": ("Jamalpur", "Mymensingh", "Netrokona", "Sherpur"),
    "Rajshahi": ("Bogura", "Chapainawabganj", "Joypurhat", "Naogaon", "Natore", "Pabna", "Rajshahi", "Sirajganj"),
    "Rangpur": ("Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari", "Panchagarh", "Rangpur", "Thakurgaon"),
    "Sylhet": ("Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"),
}

# Bangladesh mobile numbers: 01 followed by an operator digit 3-9 and eight more digits, with or
# without the +880 / 880 country code.
_MOBILE = re.compile(r"^(?:\+?880|0)?(1[3-9]\d{8})$")
_POSTCODE = re.compile(r"^\d{4}$")
_POSTAL_CODE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 \-]{1,11}$")
_E164 = re.compile(r"^[1-9]\d{6,14}$")

LIMITS = {
    "recipient_name": 120,
    "upazila": 80,
    "area": 120,
    "house_road": 200,
    "landmark": 200,
    "address_line1": 200,
    "address_line2": 200,
    "city": 120,
    "region": 120,
}


def normalize_bd_mobile(raw: str) -> str | None:
    """'01712-345678', '+880 1712345678' -> '+8801712345678'; anything else -> None."""
    digits = re.sub(r"[\s\-()]", "", raw or "")
    match = _MOBILE.match(digits)
    return f"+880{match.group(1)}" if match else None


def normalize_phone(raw: str, country: str) -> str | None:
    """A phone number in international form (E.164), from what people type: "+44 7700 900123",
    "0044 7700900123", or a national number like "07700 900123" with its country. Numbers in
    Bangladesh must be mobiles (the courier calls them). None when it can't be a phone number."""
    text = re.sub(r"[\s\-().]", "", raw or "")
    if country == "BD" and not text.startswith(("+", "00")):
        return normalize_bd_mobile(text)
    if text.startswith("00"):
        text = "+" + text[2:]
    if text.startswith("+"):
        digits = text[1:]
    else:
        dial = calling_code(country)
        if dial is None or not text.isdigit():
            return None
        national = text[1:] if text.startswith("0") and country not in KEEP_LEADING_ZERO else text
        digits = dial + national
    if not _E164.match(digits):
        return None
    if digits.startswith("880"):
        return normalize_bd_mobile("+" + digits)
    return "+" + digits


def phone_country_for(phone: str, preferred: str) -> str:
    """The country a stored number belongs to: the one chosen when its calling code fits (several
    countries share +1, +7, +44 ...), else the first with the longest matching calling code."""
    digits = phone.lstrip("+")
    dial = calling_code(preferred)
    if dial and digits.startswith(dial):
        return preferred
    best = max((c for c in COUNTRIES if digits.startswith(c[2])), key=lambda c: len(c[2]), default=None)
    if best is None:
        return preferred
    return MAIN_FOR_CODE.get(best[2], best[0])


def _invalid(field: str, message: str) -> AppError:
    # The message is for people; `field` tells the form which input to point at.
    return AppError("VALIDATION_ERROR", message, 422, message, extras={"field": field})


def clean_address(data: dict[str, object]) -> dict[str, str | None]:
    """Validate and tidy a delivery address. Raises 422 naming the first wrong field."""
    def text(field: str, *, required: bool) -> str | None:
        value = str(data.get(field) or "").strip()
        value = re.sub(r"\s+", " ", value)
        if not value:
            if required:
                raise _invalid(field, f"{LABELS.get(field, field.replace('_', ' ').capitalize())} is required")
            return None
        if field in LIMITS and len(value) > LIMITS[field]:
            raise _invalid(field, f"{LABELS.get(field, field.replace('_', ' ').capitalize())} is too long")
        return value

    country = str(data.get("country_code") or "BD").strip().upper()
    if country not in BY_CODE:
        raise _invalid("country_code", "Choose a country")
    recipient_name = text("recipient_name", required=True)
    phone_country = str(data.get("phone_country") or country).strip().upper()
    if phone_country not in BY_CODE:
        raise _invalid("phone_country", "Choose the phone number's country")
    phone = normalize_phone(str(data.get("phone") or ""), phone_country)
    if phone is None:
        raise _invalid(
            "phone",
            "Enter a Bangladesh mobile number, like 01712 345678"
            if phone_country == "BD"
            else "Enter a phone number we can call, with its country code",
        )
    out: dict[str, str | None] = {f: None for f in ADDRESS_FIELDS}
    out.update(
        country_code=country,
        recipient_name=recipient_name,
        phone=phone,
        phone_country=phone_country_for(phone, phone_country),
    )
    if country == "BD":
        division = text("division", required=True)
        if division not in DIVISIONS:
            raise _invalid("division", "Choose a division of Bangladesh")
        district = text("district", required=True)
        if district not in DIVISIONS[division]:
            raise _invalid("district", f"Choose a district in {division} division")
        postcode = text("postcode", required=False)
        if postcode is not None and not _POSTCODE.match(postcode):
            raise _invalid("postcode", "A Bangladesh postcode has 4 digits")
        out.update(
            division=division,
            district=district,
            upazila=text("upazila", required=True),
            area=text("area", required=True),
            house_road=text("house_road", required=True),
            postcode=postcode,
        )
    else:
        postcode = text("postcode", required=False)
        if postcode is not None and not _POSTAL_CODE.match(postcode):
            raise _invalid("postcode", "Check the postal code")
        out.update(
            address_line1=text("address_line1", required=True),
            address_line2=text("address_line2", required=False),
            city=text("city", required=True),
            region=text("region", required=False),
            postcode=postcode.upper() if postcode else None,
        )
    out["landmark"] = text("landmark", required=False)
    return out


LABELS = {
    "recipient_name": "Recipient's name",
    "address_line1": "Address",
    "city": "City or town",
    "house_road": "House and road",
}

ADDRESS_FIELDS = (
    "country_code",
    "recipient_name",
    "phone_country",
    "phone",
    "division",
    "district",
    "upazila",
    "area",
    "house_road",
    "address_line1",
    "address_line2",
    "city",
    "region",
    "postcode",
    "landmark",
)
