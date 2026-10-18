"""Song and release languages (D-AUDIO-16): ISO 639-1 codes, plus "zxx" (no linguistic content)
for instrumentals. Bangla, English, Hindi, Urdu and Instrumental lead the list."""

from __future__ import annotations

LANGUAGES: tuple[tuple[str, str, str], ...] = (
    ("bn", "Bangla", "বাংলা"),
    ("en", "English", "ইংরেজি"),
    ("hi", "Hindi", "হিন্দি"),
    ("ur", "Urdu", "উর্দু"),
    ("zxx", "Instrumental (no lyrics)", "যন্ত্রসংগীত"),
    ("ar", "Arabic", "আরবি"),
    ("as", "Assamese", "অসমিয়া"),
    ("zh", "Chinese", "চীনা"),
    ("fr", "French", "ফরাসি"),
    ("de", "German", "জার্মান"),
    ("gu", "Gujarati", "গুজরাটি"),
    ("ja", "Japanese", "জাপানি"),
    ("ko", "Korean", "কোরীয়"),
    ("ml", "Malayalam", "মালয়ালম"),
    ("mr", "Marathi", "মারাঠি"),
    ("ne", "Nepali", "নেপালি"),
    ("or", "Odia", "ওড়িয়া"),
    ("fa", "Persian", "ফারসি"),
    ("pt", "Portuguese", "পর্তুগিজ"),
    ("pa", "Punjabi", "পাঞ্জাবি"),
    ("sa", "Sanskrit", "সংস্কৃত"),
    ("es", "Spanish", "স্প্যানিশ"),
    ("ta", "Tamil", "তামিল"),
    ("te", "Telugu", "তেলুগু"),
    ("tr", "Turkish", "তুর্কি"),
    ("mul", "Multiple languages", "একাধিক ভাষা"),
)

_CODES = frozenset(code for code, _en, _bn in LANGUAGES)


def is_language(code: str) -> bool:
    return code in _CODES
