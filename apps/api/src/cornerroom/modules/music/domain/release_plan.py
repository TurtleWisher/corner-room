"""Where a release and its pre-sale stand, as one plan (owner, 2026-11-13, D-RELEASE-PLAN-01).

A release has two tracks that meet on release day: the pre-sale (optional: title, artist, date and
price go public early) and the music itself (details, songs, cover and price, reviewed in full).
Staff approving the music of a release whose pre-sale date is already set schedules it for that
date, so it goes out by itself; nobody has to press Schedule as well. Pure rules, no I/O: the
Studio and the staff release workspace both read this plan and show only the steps it allows.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

BEFORE_RELEASE = frozenset({"IDEA", "DEMO", "IN_PRODUCTION", "QC", "METADATA_REVIEW", "APPROVED"})
MAKING = frozenset({"IDEA", "DEMO", "IN_PRODUCTION", "QC"})


def schedule_on_approval(*, chosen: datetime | None, presale_status: str | None, release_at: datetime | None, now: datetime) -> datetime | None:
    """The date approving the music schedules it for: the date staff chose, else the approved
    pre-sale's date while it is still to come. None leaves it approved without a date."""
    if chosen is not None:
        return chosen
    if presale_status == "APPROVED" and release_at is not None and release_at > now:
        return release_at
    return None


def plan_stage(*, status: str, release_at: datetime | None, presale_status: str | None, now: datetime) -> str:
    """One word for where the release stands (the screens turn it into sentences)."""
    if status in {"RELEASED", "TAKEN_DOWN", "ARCHIVED"}:
        return status
    if status == "SCHEDULED":
        return "OVERDUE" if release_at is not None and release_at <= now else "SCHEDULED"
    if status == "APPROVED":
        if presale_status == "APPROVED" and release_at is not None and release_at <= now:
            return "APPROVED_DATE_PASSED"
        return "APPROVED"
    if status == "METADATA_REVIEW":
        return "IN_REVIEW"
    return "MAKING"


def staff_actions(
    *, status: str, presale_status: str | None, presale_listed: bool, had_presale: bool
) -> list[str]:
    """What staff can do now, so the workspace shows only those buttons (the API re-checks each)."""
    out: list[str] = []
    if status == "METADATA_REVIEW":
        out += ["approve", "request_changes"]
    elif status in {"APPROVED", "SCHEDULED"}:
        out += ["schedule", "release", "request_changes", "takedown"]
    elif status == "RELEASED":
        out.append("takedown")
        if had_presale:
            out.append("back_to_presale")
    if status in BEFORE_RELEASE:
        if presale_status == "REQUESTED":
            out += ["presale_approve", "presale_return"]
        elif presale_status == "APPROVED":
            out.append("presale_move_date")
    if presale_listed and status != "RELEASED":
        out.append("cancel_presale")
    return out


def release_plan(
    *,
    status: str,
    release_at: datetime | None,
    presale_status: str | None,
    presale_requested_at: datetime | None,
    presale_listed: bool,
    had_presale: bool,
    music_ready: bool,
    now: datetime,
) -> dict[str, Any]:
    stage = plan_stage(status=status, release_at=release_at, presale_status=presale_status, now=now)
    if status in {"SCHEDULED", "RELEASED", "TAKEN_DOWN", "ARCHIVED"} or presale_status == "APPROVED":
        day, day_kind = release_at, ("SET" if release_at is not None else None)
    elif presale_status in {"REQUESTED", "RETURNED"} and presale_requested_at is not None:
        day, day_kind = presale_requested_at, "REQUESTED"
    else:
        day, day_kind = None, None
    approval_date = None
    if status == "METADATA_REVIEW":
        approval_date = schedule_on_approval(chosen=None, presale_status=presale_status, release_at=release_at, now=now)
    return {
        "stage": stage,
        "release_day": day,
        "release_day_kind": day_kind,
        "date_passed": day is not None and day_kind == "SET" and day <= now and status != "RELEASED",
        # Out on its date with nobody pressing anything: scheduled, still to come, every song ready.
        "goes_out_by_itself": stage == "SCHEDULED" and music_ready,
        # Approving the music now schedules it for this date (the approved pre-sale's).
        "approve_schedules_for": approval_date,
        "staff_actions": staff_actions(
            status=status, presale_status=presale_status, presale_listed=presale_listed, had_presale=had_presale
        ),
    }
