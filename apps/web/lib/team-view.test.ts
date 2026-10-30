import { describe, expect, it } from "vitest";

import { memberBadge, memberName, orderTeam, takeOffAction, type TeamMember } from "./team-view";

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: "m1",
  user_id: "u1",
  display_name: "Rafi",
  email: "rafi@example.com",
  role: "MANAGER",
  status: "ACTIVE",
  requested_at: "2026-10-30T10:00:00Z",
  reviewed_at: null,
  ...over,
});

describe("artist team (D-ARTIST-UNIFY-01)", () => {
  it("lists the owner, then managers, then picks waiting for staff", () => {
    const waiting = member({ id: "w", status: "PENDING", requested_at: "2026-10-01T00:00:00Z" });
    const owner = member({ id: "o", role: "OWNER", requested_at: "2026-10-30T12:00:00Z" });
    const late = member({ id: "b", requested_at: "2026-10-30T11:00:00Z" });
    const early = member({ id: "a", requested_at: "2026-10-30T09:00:00Z" });
    expect(orderTeam([waiting, late, owner, early]).map((m) => m.id)).toEqual(["o", "a", "b", "w"]);
  });

  it("names people by their name, else their email", () => {
    expect(memberName(member())).toBe("Rafi");
    expect(memberName(member({ display_name: "  " }))).toBe("rafi@example.com");
    expect(memberName(member({ display_name: null, email: null }))).toBe("Corner Room account");
  });

  it("says plainly who owns, who manages and who is waiting", () => {
    expect(memberBadge(member({ role: "OWNER" }))).toBe("Owner");
    expect(memberBadge(member())).toBe("Manager");
    expect(memberBadge(member({ status: "PENDING" }))).toBe("Waiting for staff approval");
  });

  it("gives the owner remove and withdraw, a manager only leave, and nobody the owner", () => {
    const owner = { my_role: "OWNER" as const };
    const manager = { my_role: "MANAGER" as const };
    expect(takeOffAction(member(), owner, "u0")).toBe("remove");
    expect(takeOffAction(member({ status: "PENDING" }), owner, "u0")).toBe("withdraw");
    expect(takeOffAction(member({ role: "OWNER", user_id: "u0" }), owner, "u0")).toBeNull();
    expect(takeOffAction(member({ user_id: "u1" }), manager, "u1")).toBe("leave");
    expect(takeOffAction(member({ user_id: "u2" }), manager, "u1")).toBeNull();
  });
});
