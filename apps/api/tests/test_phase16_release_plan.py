"""D-RELEASE-PLAN-01 (owner, 2026-11-13): the pre-sale and the music as one plan. Approving the
music of a release whose pre-sale date is set schedules it for that date, so it goes out by itself."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from cornerroom.modules.music.domain.release_plan import plan_stage, release_plan, schedule_on_approval, staff_actions
from tests.auth_helpers import bearer, register_and_login
from tests.test_audio_phase4_studio import _artist_for
from tests.test_audio_phase5_intake import _orgs, _staff_with
from tests.test_audio_phase6_review import _review
from tests.test_phase16_early_presale import _finish

NOW = datetime(2026, 11, 13, 12, 0, tzinfo=timezone.utc)
SOON = NOW + timedelta(days=2)
PAST = NOW - timedelta(hours=6)


def test_approval_schedules_on_the_presale_date() -> None:
    assert schedule_on_approval(chosen=None, presale_status="APPROVED", release_at=SOON, now=NOW) == SOON
    # Staff picking a date wins; a date already gone or no approved pre-sale leaves it without one.
    later = SOON + timedelta(days=1)
    assert schedule_on_approval(chosen=later, presale_status="APPROVED", release_at=SOON, now=NOW) == later
    assert schedule_on_approval(chosen=None, presale_status="APPROVED", release_at=PAST, now=NOW) is None
    assert schedule_on_approval(chosen=None, presale_status="REQUESTED", release_at=SOON, now=NOW) is None
    assert schedule_on_approval(chosen=None, presale_status=None, release_at=None, now=NOW) is None


def test_stages() -> None:
    assert plan_stage(status="IN_PRODUCTION", release_at=None, presale_status=None, now=NOW) == "MAKING"
    assert plan_stage(status="METADATA_REVIEW", release_at=SOON, presale_status="APPROVED", now=NOW) == "IN_REVIEW"
    assert plan_stage(status="APPROVED", release_at=None, presale_status=None, now=NOW) == "APPROVED"
    assert plan_stage(status="APPROVED", release_at=PAST, presale_status="APPROVED", now=NOW) == "APPROVED_DATE_PASSED"
    assert plan_stage(status="SCHEDULED", release_at=SOON, presale_status="APPROVED", now=NOW) == "SCHEDULED"
    # Its date came but it couldn't go out (a song's audio isn't ready): staff must look.
    assert plan_stage(status="SCHEDULED", release_at=PAST, presale_status="APPROVED", now=NOW) == "OVERDUE"
    assert plan_stage(status="RELEASED", release_at=PAST, presale_status="APPROVED", now=NOW) == "RELEASED"


def test_staff_see_only_what_they_can_do() -> None:
    def acts(status: str, presale: str | None = None, listed: bool = False, had: bool = False) -> list[str]:
        return staff_actions(status=status, presale_status=presale, presale_listed=listed, had_presale=had)

    assert acts("IN_PRODUCTION") == []
    assert acts("IN_PRODUCTION", "REQUESTED") == ["presale_approve", "presale_return"]
    assert acts("METADATA_REVIEW", "APPROVED", listed=True) == ["approve", "request_changes", "presale_move_date", "cancel_presale"]
    assert acts("SCHEDULED", "APPROVED", listed=True) == ["schedule", "release", "request_changes", "takedown", "cancel_presale"]
    assert acts("RELEASED", "APPROVED", had=True) == ["takedown", "back_to_presale"]
    assert acts("RELEASED") == ["takedown"]


def test_plan_words() -> None:
    plan = release_plan(
        status="METADATA_REVIEW", release_at=SOON, presale_status="APPROVED", presale_requested_at=SOON,
        presale_listed=True, had_presale=True, music_ready=True, now=NOW,
    )
    assert plan["stage"] == "IN_REVIEW" and plan["release_day"] == SOON and plan["release_day_kind"] == "SET"
    assert plan["approve_schedules_for"] == SOON and not plan["goes_out_by_itself"] and not plan["date_passed"]
    late = release_plan(
        status="METADATA_REVIEW", release_at=PAST, presale_status="APPROVED", presale_requested_at=PAST,
        presale_listed=True, had_presale=True, music_ready=True, now=NOW,
    )
    assert late["date_passed"] and late["approve_schedules_for"] is None
    asked = release_plan(
        status="IN_PRODUCTION", release_at=None, presale_status="REQUESTED", presale_requested_at=SOON,
        presale_listed=False, had_presale=False, music_ready=False, now=NOW,
    )
    assert asked["release_day"] == SOON and asked["release_day_kind"] == "REQUESTED"
    out = release_plan(
        status="SCHEDULED", release_at=SOON, presale_status="APPROVED", presale_requested_at=SOON,
        presale_listed=True, had_presale=True, music_ready=True, now=NOW,
    )
    assert out["goes_out_by_itself"]


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_approving_the_music_schedules_the_presale_date(client: AsyncClient) -> None:
    admin, orgs = await _orgs(client)
    label = orgs["LABEL"]
    owner = await register_and_login(client, "rp-owner@example.com")
    token = owner["access_token"]
    artist_id = await _artist_for(owner["user"]["id"], label, name="Plan Act")
    reviewer = await _staff_with(client, admin, "rp-reviewer@example.com", "content_manager", label)
    release_id = (
        await client.post("/api/v1/studio/releases", headers=bearer(token), json={"profile": {"kind": "artist", "id": artist_id}, "release_type": "SINGLE", "title": "On Time"})
    ).json()["release"]["id"]
    await client.post(
        f"/api/v1/studio/releases/{release_id}/price-proposals", headers=bearer(token),
        json={"subject_type": "RELEASE", "subject_id": release_id, "audience": "PRESALE", "amount_minor": 1000},
    )
    when = datetime.now(timezone.utc) + timedelta(days=4)
    assert (await client.post(f"/api/v1/studio/releases/{release_id}/presale/request", headers=bearer(token), json={"release_at": when.isoformat()})).status_code == 200
    assert (await client.post(f"/api/v1/catalog-intake/releases/{release_id}/presale/review", headers=bearer(reviewer), json={"decision": "approve"})).status_code == 200

    await _finish(client, token, release_id)
    staff_view = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(reviewer))).json()["plan"]
    assert staff_view["stage"] == "IN_REVIEW" and staff_view["approve_schedules_for"] is not None
    assert "approve" in staff_view["staff_actions"]
    # The artist sees the plan but no staff steps.
    assert (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()["plan"]["staff_actions"] == []

    # One press: no Start review, no Schedule. It is scheduled for the pre-sale date.
    approved = await _review(client, reviewer, release_id, "approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "SCHEDULED"
    plan = (await client.get(f"/api/v1/studio/releases/{release_id}", headers=bearer(token))).json()["plan"]
    assert plan["stage"] == "SCHEDULED" and plan["goes_out_by_itself"]
