"""Bangladesh delivery address (D-ADDR-01). Pure rules: shape and validation, no I/O.

The divisions and districts are Bangladesh's official administrative list (8 divisions, 64
districts), held as reference data so the web form and the API use the same names. Upazila/thana,
area and house/road are typed, because a complete upazila list is not kept here.
"""

from __future__ import annotations

import re

from cornerroom.infra.errors import AppError

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

LIMITS = {
    "recipient_name": 120,
    "upazila": 80,
    "area": 120,
    "house_road": 200,
    "landmark": 200,
}


def normalize_bd_mobile(raw: str) -> str | None:
    """'01712-345678', '+880 1712345678' -> '+8801712345678'; anything else -> None."""
    digits = re.sub(r"[\s\-()]", "", raw or "")
    match = _MOBILE.match(digits)
    return f"+880{match.group(1)}" if match else None


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
                raise _invalid(field, f"{field.replace('_', ' ').capitalize()} is required")
            return None
        if field in LIMITS and len(value) > LIMITS[field]:
            raise _invalid(field, f"{field.replace('_', ' ').capitalize()} is too long")
        return value

    recipient_name = text("recipient_name", required=True)
    phone = normalize_bd_mobile(str(data.get("phone") or ""))
    if phone is None:
        raise _invalid("phone", "Enter a Bangladesh mobile number, like 01712 345678")
    division = text("division", required=True)
    if division not in DIVISIONS:
        raise _invalid("division", "Choose a division of Bangladesh")
    district = text("district", required=True)
    if district not in DIVISIONS[division]:
        raise _invalid("district", f"Choose a district in {division} division")
    postcode = text("postcode", required=False)
    if postcode is not None and not _POSTCODE.match(postcode):
        raise _invalid("postcode", "A Bangladesh postcode has 4 digits")
    return {
        "recipient_name": recipient_name,
        "phone": phone,
        "division": division,
        "district": district,
        "upazila": text("upazila", required=True),
        "area": text("area", required=True),
        "house_road": text("house_road", required=True),
        "postcode": postcode,
        "landmark": text("landmark", required=False),
    }


ADDRESS_FIELDS = ("recipient_name", "phone", "division", "district", "upazila", "area", "house_road", "postcode", "landmark")
