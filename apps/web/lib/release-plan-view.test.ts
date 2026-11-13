import { describe, expect, it } from "vitest";

import type { ReleasePlan, StudioReleaseDetail } from "@/features/studio/api";

import { artistNextStep, can, dhaka, firstMissingPart, musicSentBack, planSteps, staffHeadline } from "./release-plan-view";

const DAY = "2026-11-12T18:00:00Z"; // Fri 13 Nov 2026, 12:00 AM in Dhaka

type D = Pick<StudioReleaseDetail, "release" | "presale" | "readiness" | "history" | "plan">;

function make(over: { status?: string; plan?: Partial<ReleasePlan>; presale?: Partial<NonNullable<D["presale"]>> | null; missing?: string[]; history?: D["history"] } = {}): D {
  const presale =
    over.presale === null
      ? undefined
      : {
          status: null,
          requested_release_at: null,
          release_at: null,
          note: null,
          requested_at: null,
          decided_at: null,
          price: null,
          price_live: false,
          listed: false,
          open: false,
          can_request: true,
          can_withdraw: false,
          email: null,
          ...over.presale,
        };
  return {
    release: { id: "r1", title: "Night", release_type: "SINGLE", status: over.status ?? "IN_PRODUCTION", release_timezone: "Asia/Dhaka", track_sales: "RELEASE_ONLY", intake_mode: "ASSISTED", version: 1 },
    presale: presale as D["presale"],
    readiness: { ready: !(over.missing ?? []).length, items: (over.missing ?? []).map((code) => ({ code, ok: false })) },
    history: over.history ?? [],
    plan: { stage: "MAKING", date_passed: false, goes_out_by_itself: false, staff_actions: [], ...over.plan },
  };
}

describe("release plan words (D-RELEASE-PLAN-01)", () => {
  it("writes times in Dhaka time", () => {
    expect(dhaka(DAY)).toBe("Fri 13 Nov 2026, 12:00 AM");
  });

  it("asks the artist to finish before the pre-sale date", () => {
    const d = make({
      presale: { status: "APPROVED", release_at: DAY, listed: true, open: true, can_request: false },
      plan: { release_day: DAY, release_day_kind: "SET" },
      missing: ["COVER", "TRACK_AUDIO"],
    });
    const [presale, music, day] = planSteps(d, "artist");
    expect(presale).toMatchObject({ state: "done", status: "Live" });
    expect(music).toMatchObject({ state: "now", status: "2 things missing", part: "details" });
    expect(day).toMatchObject({ state: "todo", status: "Fri 13 Nov 2026, 12:00 AM" });
    expect(day.detail).toContain("Goes out by itself");
    const next = artistNextStep(d);
    expect(next.text).toContain("before Fri 13 Nov 2026, 12:00 AM");
    expect(next.cta).toBe("Finish the music");
  });

  it("tells the artist nothing is needed once it is scheduled", () => {
    const d = make({
      status: "SCHEDULED",
      presale: { status: "APPROVED", release_at: DAY, listed: true, open: true, can_request: false },
      plan: { stage: "SCHEDULED", release_day: DAY, release_day_kind: "SET", goes_out_by_itself: true },
    });
    expect(artistNextStep(d)).toMatchObject({ tone: "good" });
    expect(planSteps(d, "artist")[2]).toMatchObject({ state: "done" });
    expect(planSteps(d, "artist")[2].detail).toContain("Goes out by itself");
  });

  it("says when the music is waiting and approval schedules it", () => {
    const d = make({ status: "METADATA_REVIEW", plan: { stage: "IN_REVIEW", release_day: DAY, release_day_kind: "SET", approve_schedules_for: DAY } });
    expect(planSteps(d, "staff")[1]).toMatchObject({ state: "waiting", status: "Waiting for you" });
    expect(planSteps(d, "artist")[1]).toMatchObject({ status: "With Corner Room" });
    expect(staffHeadline(d).text).toContain("schedules it for the pre-sale date");
    expect(artistNextStep(d).text).toContain("goes out by itself");
  });

  it("flags a date that passed while the music waited", () => {
    const d = make({ status: "METADATA_REVIEW", plan: { stage: "IN_REVIEW", release_day: DAY, release_day_kind: "SET", date_passed: true } });
    expect(staffHeadline(d).tone).toBe("problem");
    expect(planSteps(d, "staff")[2]).toMatchObject({ state: "problem", status: "Date passed" });
    const approved = make({ status: "APPROVED", plan: { stage: "APPROVED_DATE_PASSED", release_day: DAY, release_day_kind: "SET", date_passed: true } });
    expect(staffHeadline(approved).title).toContain("date has passed");
  });

  it("shows a sent-back release and pre-sale as problems", () => {
    const back = make({ history: [{ action: "request_changes", note: "Fix the cover", from_status: "METADATA_REVIEW", to_status: "IN_PRODUCTION", created_at: DAY }] });
    expect(musicSentBack(back)).toBe("Fix the cover");
    expect(planSteps(back, "artist")[1]).toMatchObject({ state: "problem" });
    const returned = make({ presale: { status: "RETURNED", note: "Later date please" } });
    expect(artistNextStep(returned)).toMatchObject({ tone: "problem", part: "presale" });
  });

  it("reads staff steps only from the API", () => {
    const d = make({ plan: { staff_actions: ["approve", "request_changes"] } });
    expect(can(d.plan, "approve")).toBe(true);
    expect(can(d.plan, "release")).toBe(false);
    expect(can(undefined, "approve")).toBe(false);
  });

  it("sends the artist to the first part with something missing", () => {
    expect(firstMissingPart(make({ missing: ["TRACK_AUDIO", "PRICE"] }))).toBe("songs");
    expect(firstMissingPart(make({ missing: [] }))).toBe("review");
  });
});
