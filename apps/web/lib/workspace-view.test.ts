import { describe, expect, it } from "vitest";

import { invitationsForActiveOrg, membersForActiveOrg, rowsForActiveOrg } from "./workspace-view";

const memberA = {
  id: "m1",
  organization_id: "org-a",
  user_id: "u1",
  role_id: null,
  status: "ACTIVE",
  ended_at: null,
};

describe("workspace switch must not leak stale collections", () => {
  it("returns members only for the active organization", () => {
    expect(membersForActiveOrg("org-a", "org-a", [memberA])).toEqual([memberA]);
  });

  it("drops members after switching away", () => {
    expect(membersForActiveOrg("org-b", "org-a", [memberA])).toEqual([]);
  });

  it("filters invitations to the active org", () => {
    const invites = [
      { id: "i1", organization_id: "org-a" },
      { id: "i2", organization_id: "org-b" },
    ];
    expect(invitationsForActiveOrg("org-a", invites).map((row) => row.id)).toEqual(["i1"]);
  });

  it("drops artists and bands after switching away", () => {
    const artists = [
      { id: "a1", primary_org_id: "org-a", stage_name: "Nila" },
      { id: "a2", primary_org_id: "org-b", stage_name: "Other" },
    ];
    expect(rowsForActiveOrg("org-a", artists).map((row) => row.id)).toEqual(["a1"]);
    expect(rowsForActiveOrg("org-b", artists).map((row) => row.id)).toEqual(["a2"]);
    expect(rowsForActiveOrg(null, artists)).toEqual([]);
  });

  it("drops events and venues after switching away", () => {
    const events = [
      { id: "e1", organization_id: "org-a", title: "Show" },
      { id: "e2", organization_id: "org-b", title: "Other" },
    ];
    expect(rowsForActiveOrg("org-a", events).map((row) => row.id)).toEqual(["e1"]);
    expect(rowsForActiveOrg("org-b", events).map((row) => row.id)).toEqual(["e2"]);
    expect(rowsForActiveOrg(null, events)).toEqual([]);
  });

  it("drops catalog rows after switching away", () => {
    const releases = [
      { id: "r1", primary_org_id: "org-a", title: "River" },
      { id: "r2", primary_org_id: "org-b", title: "Other" },
    ];
    expect(rowsForActiveOrg("org-a", releases).map((row) => row.id)).toEqual(["r1"]);
    expect(rowsForActiveOrg("org-b", releases).map((row) => row.id)).toEqual(["r2"]);
    expect(rowsForActiveOrg(null, releases)).toEqual([]);
  });
});
