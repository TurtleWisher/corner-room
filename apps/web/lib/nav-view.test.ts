import { describe, expect, it } from "vitest";

import {
  ACCOUNT_NAV,
  ARTIST_NAV,
  LISTEN_NAV,
  PUBLIC_NAV,
  activeHref,
  initials,
  isActivePath,
  menuSections,
  showStaffEntry,
  staffBreadcrumb,
  staffNavSections,
} from "@/lib/nav-view";

const ALL = ["finance.read", "analytics.read", "audit.read", "user.admin", "org.admin"];
const hrefs = (sections: { items: { href: string }[] }[]) => sections.flatMap((s) => s.items.map((i) => i.href));

describe("staffNavSections", () => {
  it("keeps the always-visible staff destinations without permissions", () => {
    expect(hrefs(staffNavSections([]))).toEqual(["/events", "/venues", "/staff/commerce", "/staff/royalties", "/staff/campaigns"]);
    expect(staffNavSections(undefined).map((s) => s.label)).toEqual(["Live", "Money", "Marketing"]);
  });

  it("adds gated destinations with the same flags as before", () => {
    const sections = staffNavSections(ALL);
    expect(sections.map((s) => s.label)).toEqual(["Live", "Money", "Marketing", "Insight", "Admin"]);
    expect(hrefs(sections)).toEqual(
      expect.arrayContaining(["/staff/finance", "/staff/analytics", "/staff/ops", "/staff/audit", "/staff/users", "/staff/organizations"]),
    );
  });

  it("names the breadcrumb from the most specific item", () => {
    const sections = staffNavSections(ALL);
    expect(staffBreadcrumb("/staff/finance", sections)).toEqual(["Money", "Finance"]);
    expect(staffBreadcrumb("/staff/users/42", sections)).toEqual(["Admin", "Users"]);
    expect(staffBreadcrumb("/organizations/1", sections)).toEqual(["Workspace", "Organizations"]);
    expect(staffBreadcrumb("/nowhere", sections)).toBeNull();
  });
});

describe("menuSections", () => {
  it("adds the You section only when signed in", () => {
    expect(menuSections(false).map((s) => s.label)).toEqual(["Discover", "Listen"]);
    expect(menuSections(true).map((s) => s.label)).toEqual(["Discover", "Listen", "You"]);
  });
});

describe("helpers", () => {
  it("shows the staff entry for any permission or membership only", () => {
    expect(showStaffEntry([], 0)).toBe(false);
    expect(showStaffEntry(undefined, 0)).toBe(false);
    expect(showStaffEntry(["event.read"], 0)).toBe(true);
    expect(showStaffEntry([], 1)).toBe(true);
  });

  it("makes avatar initials", () => {
    expect(initials("Tanvir Ops")).toBe("TO");
    expect(initials("Nadia Rahman")).toBe("NR");
    expect(initials("Rumi")).toBe("RU");
    expect(initials(null, "fan@example.test")).toBe("FA");
    expect(initials(null, null)).toBe("ME");
  });

  it("matches active paths", () => {
    expect(isActivePath("/events/abc", "/events")).toBe(true);
    expect(isActivePath("/eventsx", "/events")).toBe(false);
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/discover", "/")).toBe(false);
    expect(activeHref("/artists/apply", [{ href: "/artists", label: "" }, { href: "/artists/apply", label: "" }])).toBe("/artists/apply");
  });
});

describe("every pre-Stage 5 destination is still linked", () => {
  it("covers the old flat header", () => {
    const linked = new Set(
      [...PUBLIC_NAV, ...LISTEN_NAV, ...ACCOUNT_NAV, ...ARTIST_NAV, ...menuSections(true).flatMap((s) => s.items), ...staffNavSections(ALL).flatMap((s) => s.items)].map(
        (i) => i.href,
      ),
    );
    const old = [
      "/search", "/organizations", "/events", "/venues", "/artists", "/bands", "/releases", "/tracks", "/listen",
      "/store", "/purchases", "/subscriptions", "/library", "/playlists", "/history", "/tickets", "/orders",
      "/staff/commerce", "/royalties", "/staff/royalties", "/staff/finance", "/staff/campaigns", "/staff/analytics",
      "/staff/ops", "/staff/audit", "/staff/users", "/staff/organizations", "/account", "/discover",
    ];
    for (const href of old) expect(linked).toContain(href);
  });
});
