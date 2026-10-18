import { describe, expect, it } from "vitest";

import { applicationActions, applicationStage, artistJoinLink, canApplyAgain, inviteLink, joinLinkState, memberLabel } from "./onboarding-view";

describe("artist applications", () => {
  it("says where an application stands", () => {
    expect(applicationStage({ status: "SUBMITTED" }).title).toBe("Sent");
    expect(applicationStage({ status: "UNDER_REVIEW" }).tone).toBe("progress");
    expect(applicationStage({ status: "APPROVED", artist_status: "APPROVED" }).title).toBe("Approved");
    expect(applicationStage({ status: "APPROVED", artist_status: "ACTIVE" })).toMatchObject({ title: "You're in", tone: "good" });
    expect(applicationStage({ status: "REJECTED" }).tone).toBe("attention");
  });

  it("offers a new application only when none is open", () => {
    expect(canApplyAgain([])).toBe(true);
    expect(canApplyAgain([{ status: "REJECTED" }])).toBe(true);
    expect(canApplyAgain([{ status: "UNDER_REVIEW" }])).toBe(false);
    expect(canApplyAgain([{ status: "APPROVED", artist_status: "ACTIVE" }])).toBe(false);
  });

  it("gives staff the next step for each application", () => {
    expect(applicationActions({ status: "SUBMITTED" }).map((a) => a.action)).toEqual(["start_review"]);
    expect(applicationActions({ status: "UNDER_REVIEW" }).map((a) => a.action)).toEqual(["approve", "reject"]);
    expect(applicationActions({ status: "APPROVED", artist_status: "APPROVED" })).toEqual([{ action: "activate", label: "Activate the artist", target: "artist" }]);
    expect(applicationActions({ status: "APPROVED", artist_status: "ACTIVE" })).toEqual([]);
  });
});

describe("staff invitations", () => {
  it("builds the staff and artist join links", () => {
    expect(inviteLink("http://localhost:3000/", "a+b/c")).toBe("http://localhost:3000/staff/join?invite=a%2Bb%2Fc");
    expect(artistJoinLink("http://localhost:3000", "xyz")).toBe("http://localhost:3000/studio/join?code=xyz");
  });

  it("names members by name and email when the API shares them", () => {
    expect(memberLabel({ user_id: "abcdef1234", display_name: "Mitu", email: "m@example.com" })).toEqual({ primary: "Mitu", secondary: "m@example.com" });
    expect(memberLabel({ user_id: "abcdef1234" })).toEqual({ primary: "Member abcdef12", secondary: null });
  });
});

describe("join links", () => {
  it("says whether a link still works", () => {
    const base = { status: "ACTIVE", usable: true, max_uses: null, uses: 0, expires_at: null };
    expect(joinLinkState(base)).toBe("Active");
    expect(joinLinkState({ ...base, status: "DISABLED" })).toBe("Switched off");
    expect(joinLinkState({ ...base, max_uses: 2, uses: 2 })).toBe("Full");
    expect(joinLinkState({ ...base, expires_at: "2020-01-01T00:00:00Z" })).toBe("Ended");
  });
});

