import { describe, expect, it } from "vitest";

import {
  ACCOUNT_NAV,
  ARTIST_NAV,
  LISTEN_NAV,
  PUBLIC_NAV,
  activeHref,
  initials,
  isActivePath,
  isStudioAuthPath,
  filterNavForUser,
  menuSections,
  navFlagsFor,
  showStaffEntry,
  showStaffSignInLink,
  staffBreadcrumb,
  studioNavSections,
  staffNavSections,
} from "@/lib/nav-view";

const ALL = ["finance.read", "analytics.read", "audit.read", "user.admin", "org.admin"];
const hrefs = (sections: { items: { href: string }[] }[]) => sections.flatMap((s) => s.items.map((i) => i.href));

describe("staffNavSections", () => {
  it("keeps the always-visible staff destinations without permissions", () => {
    expect(hrefs(staffNavSections([]))).toEqual(["/staff/events", "/staff/venues", "/staff/catalog", "/staff/catalog/artists", "/staff/catalog/processing", "/staff/commerce", "/staff/royalties", "/staff/campaigns"]);
    expect(staffNavSections(undefined).map((s) => s.label)).toEqual(["Live", "Catalog", "Money", "Marketing"]);
  });

  it("adds gated destinations with the same flags as before", () => {
    const sections = staffNavSections(ALL);
    expect(sections.map((s) => s.label)).toEqual(["Live", "Catalog", "Money", "Marketing", "Insight", "Admin"]);
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
    expect(menuSections(true).map((s) => s.label)).toEqual(["Discover", "Listen", "You", "Artist"]);
    // A fan: no artist or staff places, only the way to apply.
    const fan = menuSections(true);
    expect(fan.find((x) => x.label === "You")?.items.map((i) => i.href)).not.toContain("/organizations");
    expect(fan.find((x) => x.label === "You")?.items.map((i) => i.href)).not.toContain("/royalties");
    expect(fan.at(-1)?.items.map((i) => i.href)).toEqual(["/artists/apply"]);
    // An artist who is also staff: Studio, sales and royalties, workspaces, no apply.
    const both = menuSections(true, { isArtist: true, hasWorkspace: true });
    expect(both.find((x) => x.label === "You")?.items.map((i) => i.href)).toContain("/organizations");
    expect(both.at(-1)?.items.map((i) => i.href)).toEqual(["/studio", "/studio/sales", "/royalties"]);
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
      "/search", "/organizations", "/events", "/staff/events", "/staff/venues", "/artists", "/bands", "/releases", "/tracks", "/listen",
      "/store", "/purchases", "/subscriptions", "/library", "/playlists", "/history", "/tickets", "/orders",
      "/staff/commerce", "/royalties", "/staff/royalties", "/staff/finance", "/staff/campaigns", "/staff/analytics",
      "/staff/ops", "/staff/audit", "/staff/users", "/staff/organizations", "/account",
    ];
    for (const href of old) expect(linked).toContain(href);
  });
});

describe("filterNavForUser", () => {
  it("reads the flags from /me and treats missing as no", () => {
    expect(navFlagsFor(null)).toEqual({ isArtist: false, hasWorkspace: false });
    expect(navFlagsFor({ is_artist: true })).toEqual({ isArtist: true, hasWorkspace: false });
    expect(filterNavForUser([{ href: "/studio", label: "Studio" }, { href: "/account", label: "Account" }], {})).toEqual([{ href: "/account", label: "Account" }]);
    expect(filterNavForUser([{ href: "/studio/sales", label: "Sales" }], {})).toEqual([]);
    expect(activeHref("/studio/sales", ARTIST_NAV)).toBe("/studio/sales");
    expect(activeHref("/studio/releases/x", ARTIST_NAV)).toBe("/studio");
  });
});

describe("studioNavSections", () => {
  it("lists only real Studio places, with plays for artist profiles", () => {
    expect(studioNavSections([]).map((s) => s.items.map((i) => i.href))).toEqual([["/studio", "/studio/sales", "/royalties"]]);
    const both = studioNavSections([
      { kind: "artist", id: "a1", display_name: "Rumi" },
      { kind: "band", id: "b1", display_name: "Kaal Bela" },
    ]);
    expect(both[1]).toEqual({ label: "Plays", items: [{ href: "/artists/a1/analytics", label: "Rumi" }] });
    expect(staffBreadcrumb("/studio/sales", both)).toEqual(["Studio", "Sales"]);
    expect(staffBreadcrumb("/studio/releases/x", both)).toEqual(["Studio", "Your music"]);
    expect(isStudioAuthPath("/studio/sign-in")).toBe(true);
    expect(isStudioAuthPath("/studio/join")).toBe(true);
    expect(isStudioAuthPath("/studio")).toBe(false);
    expect(isStudioAuthPath("/studio/sales")).toBe(false);
  });
});

describe("showStaffSignInLink", () => {
  it("offers staff sign-in to signed-in people who aren't already staff", () => {
    expect(showStaffSignInLink(true, [], 0)).toBe(true);
    expect(showStaffSignInLink(false, [], 0)).toBe(false);
    expect(showStaffSignInLink(true, ["event.read"], 0)).toBe(false);
    expect(showStaffSignInLink(true, [], 1)).toBe(false);
  });
});
