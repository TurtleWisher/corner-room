import { describe, expect, it } from "vitest";

import type { StaffAccount, StaffArea, StaffInvite } from "@/features/staff-portal/api";

import { addProblem, agoWords, areaLabels, emailProblem, filterAccounts, filterInvites, groupAreas, levelCounts, toggle } from "./staff-accounts-view";
import { actionWords, barHeights, countWords, dayHeading, entityHref, groupByDay } from "./staff-activity-view";

const AREAS: StaffArea[] = [
  { key: "content_manager", label: "Music review", does: "", group: "Music" },
  { key: "event_manager", label: "Events", does: "", group: "Live" },
  { key: "media_operator", label: "Audio processing", does: "", group: "Music" },
];

function account(over: Partial<StaffAccount>): StaffAccount {
  return {
    user_id: "u",
    name: "Rumi",
    email: "rumi@example.com",
    picture_url: null,
    level: "STAFF",
    areas: [],
    status: "ACTIVE",
    google_linked: true,
    last_active_at: null,
    actions_7d: 0,
    is_you: false,
    can_change: true,
    ...over,
  };
}

describe("staff accounts", () => {
  it("checks the add form", () => {
    expect(emailProblem("")).toMatch(/Type their email/);
    expect(emailProblem("nope")).toMatch(/full email/);
    expect(emailProblem(" a@gmail.com ")).toBeNull();
    expect(addProblem({ email: "a@gmail.com", level: null, areas: [] })).toMatch(/Admin or Staff/);
    expect(addProblem({ email: "a@gmail.com", level: "STAFF", areas: [] })).toMatch(/at least one area/);
    expect(addProblem({ email: "a@gmail.com", level: "STAFF", areas: ["analyst"] })).toBeNull();
    expect(addProblem({ email: "a@gmail.com", level: "ADMIN", areas: [] })).toBeNull();
  });

  it("names and groups areas", () => {
    expect(areaLabels(["event_manager", "unknown"], AREAS)).toEqual(["Events", "unknown"]);
    expect(groupAreas(AREAS).map((g) => [g.group, g.areas.length])).toEqual([
      ["Music", 2],
      ["Live", 1],
    ]);
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });

  it("filters and counts", () => {
    const list = [account({ user_id: "1", level: "OWNER", name: "Owner" }), account({ user_id: "2", areas: ["event_manager"] }), account({ user_id: "3", level: "ADMIN", name: "Mim" })];
    expect(filterAccounts(list, "ADMIN", "", AREAS).map((a) => a.user_id)).toEqual(["3"]);
    expect(filterAccounts(list, "all", "events", AREAS).map((a) => a.user_id)).toEqual(["2"]);
    const invites = [{ email: "x@gmail.com" } as StaffInvite, { email: "y@example.com" } as StaffInvite];
    expect(filterInvites(invites, "gmail").length).toBe(1);
    expect(levelCounts(list, invites)).toEqual({ all: 3, OWNER: 1, ADMIN: 1, STAFF: 1, waiting: 2 });
  });

  it("says how long ago", () => {
    const now = new Date("2026-11-28T12:00:00Z");
    expect(agoWords(null, now)).toBe("No actions yet");
    expect(agoWords("2026-11-28T11:59:40Z", now)).toBe("Just now");
    expect(agoWords("2026-11-28T11:48:00Z", now)).toBe("12 min ago");
    expect(agoWords("2026-11-28T09:00:00Z", now)).toBe("3 h ago");
    expect(agoWords("2026-11-27T10:00:00Z", now)).toBe("Yesterday");
    expect(agoWords("2026-11-20T10:00:00Z", now)).toBe("8 days ago");
  });
});

describe("staff activity", () => {
  it("says actions in words", () => {
    expect(actionWords("release.approved")).toBe("Approved a release");
    expect(actionWords("royalty_rate.set")).toBe("Set an artist's royalty rate");
    expect(actionWords("gift_campaign.reviewed")).toBe("Reviewed · gift campaign");
    expect(actionWords("thing")).toBe("Thing");
  });

  it("links where a staff page exists", () => {
    expect(entityHref("Release", "r1")).toBe("/staff/catalog/releases/r1");
    expect(entityHref("Artist", "a1", "royalty_rate.set")).toBe("/staff/royalties?artist=a1");
    expect(entityHref("Artist", "a1", "artist.updated")).toBeNull();
    expect(entityHref("Order", "o1")).toBeNull();
  });

  it("groups by Dhaka day", () => {
    const now = new Date("2026-11-28T12:00:00Z");
    // 19:30 UTC on the 27th is already the 28th in Dhaka (UTC+6).
    const rows = [{ occurred_at: "2026-11-28T10:00:00Z" }, { occurred_at: "2026-11-27T19:30:00Z" }, { occurred_at: "2026-11-27T10:00:00Z" }];
    const groups = groupByDay(rows, now);
    expect(groups.map((g) => [g.heading, g.items.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
    ]);
    expect(dayHeading("2026-11-20T10:00:00Z", now)).not.toMatch(/Today|Yesterday/);
  });

  it("counts and bars", () => {
    expect(countWords(1234)).toBe("1,234");
    expect(countWords(null)).toBe("Not available");
    expect(barHeights([0, 2, 4])).toEqual([0, 0.5, 1]);
    expect(barHeights([0, 0])).toEqual([0, 0]);
  });
});
