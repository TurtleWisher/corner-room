import { describe, expect, it } from "vitest";

import {
  currentAudio,
  displayStateLabel,
  displayStateTone,
  missingCount,
  moveItem,
  parsePriceToMinor,
  profileReasonText,
  coverReportState,
  readinessRows,
  submitPanelMode,
  releaseToContinue,
  proposalWords,
  reviewEventText,
} from "./studio-view";

describe("studio view", () => {
  it("words display states from the API", () => {
    expect(displayStateLabel("CHECKING_AUDIO")).toBe("Checking your audio");
    expect(displayStateTone("NEEDS_ATTENTION")).toBe("attention");
    expect(displayStateTone("RELEASED")).toBe("good");
    expect(displayStateLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("explains why a profile can't publish", () => {
    expect(profileReasonText("PROFILE_NOT_ACTIVE")).toMatch(/activated/);
    expect(profileReasonText(null)).toBeNull();
  });

  it("names the track on per-track readiness items", () => {
    const rows = readinessRows(
      [
        { code: "COVER", ok: false },
        { code: "TRACK_AUDIO", ok: true, track_id: "t1" },
      ],
      [{ id: "t1", title: "Kaal Bela", position: 1 }],
    );
    expect(rows[0].text).toMatch(/Cover art/);
    expect(rows[1].text).toBe("1. Kaal Bela: master audio that passed its checks");
    expect(missingCount([{ code: "A", ok: false }, { code: "B", ok: true }])).toBe(1);
  });

  it("reorders only within bounds", () => {
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });

  it("reads typed prices into minor units without guessing", () => {
    expect(parsePriceToMinor("120")).toBe(12000);
    expect(parsePriceToMinor("1,200.5")).toBe(120050);
    expect(parsePriceToMinor("৳ 50")).toBe(5000);
    expect(parsePriceToMinor("12.345")).toBeNull();
    expect(parsePriceToMinor("abc")).toBeNull();
  });

  it("picks the audio version to show", () => {
    const audio = [
      { version_id: "old", status: "READY", is_current: true, has_audio: true },
      { version_id: "new", status: "PROCESSING", is_current: false, has_audio: true },
    ];
    expect(currentAudio({ audio })?.version_id).toBe("new");
    expect(currentAudio({ audio: [] })).toBeNull();
  });
});

describe("review history", () => {
  it("words reviewer actions", () => {
    expect(reviewEventText("request_changes")).toBe("Changes requested");
    expect(reviewEventText("release")).toBe("Released");
    expect(reviewEventText("other")).toBe("other");
  });
});

describe("price proposals", () => {
  it("says what is priced and for whom", () => {
    expect(proposalWords({ subject_type: "RELEASE", subject_title: "Monsoon", audience: "EVERYONE" })).toEqual({ subject: "Whole release", audience: "Everyone" });
    expect(proposalWords({ subject_type: "TRACK", subject_title: " Tin Roof ", audience: "EVERYONE" }).subject).toBe("Track: Tin Roof");
    expect(proposalWords({ subject_type: "RELEASE", audience: "OWNS_PART_OF_RELEASE" }).audience).toBe("Fans who already own some of its songs");
  });
});

describe("releaseToContinue", () => {
  const r = (id: string, display_state: string, updated_at: string) => ({ id, display_state, updated_at });
  it("picks the newest release that waits on the artist, or nothing", () => {
    expect(releaseToContinue([])).toBeNull();
    expect(releaseToContinue([r("a", "IN_REVIEW", "2026-10-20T10:00:00Z"), r("b", "RELEASED", "2026-10-21T10:00:00Z")])).toBeNull();
    const pick = releaseToContinue([
      r("old", "DRAFT", "2026-10-01T10:00:00Z"),
      r("fix", "NEEDS_ATTENTION", "2026-10-20T10:00:00Z"),
      r("busy", "CHECKING_AUDIO", "2026-10-22T10:00:00Z"),
    ]);
    expect(pick?.id).toBe("fix");
  });
});

describe("coverReportState", () => {
  it("says how the latest cover stands, from the server's status", () => {
    expect(coverReportState(null).state).toBe("none");
    expect(coverReportState({ asset_status: "QUARANTINED" }).state).toBe("checking");
    expect(coverReportState({ asset_status: "PENDING" }).state).toBe("checking");
    expect(coverReportState({ asset_status: "ACCEPTED" })).toEqual({ state: "accepted", text: "Cover accepted." });
    expect(coverReportState({ asset_status: "READY" }).state).toBe("accepted");
    expect(coverReportState({ asset_status: "REJECTED" }).text).toMatch(/wasn't accepted/);
    expect(coverReportState({ asset_status: "ACCEPTED" }, "poster").text).toBe("Poster accepted.");
    expect(coverReportState(null, "poster").text).toBe("No poster uploaded yet.");
  });
});

describe("submitPanelMode", () => {
  it("offers submit only while the release is being prepared", () => {
    expect(submitPanelMode("IDEA")).toBe("submit");
    expect(submitPanelMode("IN_PRODUCTION")).toBe("submit");
    expect(submitPanelMode("METADATA_REVIEW")).toBe("in_review");
    expect(submitPanelMode("APPROVED")).toBe("past_review");
    expect(submitPanelMode("RELEASED")).toBe("past_review");
    expect(submitPanelMode("SOMETHING_NEW")).toBe("past_review");
  });
});
