"""Integer minor-unit money. No floats. No tables required in Phase 0."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Money:
    amount_minor: int
    currency_code: str

    def __post_init__(self) -> None:
        if not isinstance(self.amount_minor, int):
            raise TypeError("amount_minor must be int, never float")
        code = self.currency_code.upper()
        if len(code) != 3 or not code.isalpha():
            raise ValueError("currency_code must be ISO-4217 alpha-3")
        object.__setattr__(self, "currency_code", code)

    def to_dict(self) -> dict[str, int | str]:
        return {"amount_minor": self.amount_minor, "currency_code": self.currency_code}
