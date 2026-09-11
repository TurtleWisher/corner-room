"""Provisional chart-of-accounts seeds. Not a statutory COA (Q-P1-22)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ProvisionalAccount:
    code: str
    name: str
    type: str


# Engineer fixture names only. Accountant chart remains OPEN (Q-P1-22).
PROVISIONAL_COA: tuple[ProvisionalAccount, ...] = (
    ProvisionalAccount("1000", "Cash / PSP clearing", "ASSET"),
    ProvisionalAccount("1100", "Accounts receivable", "ASSET"),
    ProvisionalAccount("2000", "Accounts payable", "LIABILITY"),
    ProvisionalAccount("2100", "Deferred revenue", "LIABILITY"),
    ProvisionalAccount("2200", "Royalty liability", "LIABILITY"),
    ProvisionalAccount("2300", "Tax payable", "LIABILITY"),
    ProvisionalAccount("4000", "Ticket revenue", "REVENUE"),
    ProvisionalAccount("4100", "Subscription revenue", "REVENUE"),
    ProvisionalAccount("4200", "Music purchase revenue", "REVENUE"),
    ProvisionalAccount("4300", "Sponsorship revenue", "REVENUE"),
    ProvisionalAccount("4400", "Platform income", "REVENUE"),
    ProvisionalAccount("4500", "Contra-revenue", "REVENUE"),
    ProvisionalAccount("5000", "Operating expense", "EXPENSE"),
    ProvisionalAccount("5100", "Royalty expense", "EXPENSE"),
    ProvisionalAccount("5900", "Rounding residue", "EXPENSE"),
)

CODE_PSP_CLEARING = "1000"
CODE_AR = "1100"
CODE_AP = "2000"
CODE_DEFERRED_REVENUE = "2100"
CODE_ROYALTY_LIABILITY = "2200"
CODE_TAX_PAYABLE = "2300"
CODE_TICKET_REVENUE = "4000"
CODE_SUBSCRIPTION_REVENUE = "4100"
CODE_MUSIC_REVENUE = "4200"
CODE_SPONSORSHIP_REVENUE = "4300"
CODE_PLATFORM_INCOME = "4400"
CODE_CONTRA_REVENUE = "4500"
CODE_EXPENSE = "5000"
CODE_ROYALTY_EXPENSE = "5100"
CODE_ROUNDING = "5900"
