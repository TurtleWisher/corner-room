import { staffNavFlags } from "@/lib/auth-view";

/*
 * Navigation model for the shells. UX only: hiding a link is never authorization, the API decides
 * every permission. Every destination of the pre-Stage 5 header is still linked somewhere here.
 */

export type NavItem = { href: string; label: string };
export type NavSection = { label: string; items: NavItem[] };

/** Public header (1024 px and up). "Events" is the public What's on list. */
export const PUBLIC_NAV: NavItem[] = [
  { href: "/events", label: "Events" },
  { href: "/listen", label: "Listen" },
  { href: "/artists", label: "Artists" },
  { href: "/releases", label: "Releases" },
  { href: "/store", label: "Store" },
];

export const SEARCH_HREF = "/search";

/** Second row inside the listening room. */
export const LISTEN_NAV: NavItem[] = [
  { href: "/listen", label: "Listen" },
  { href: "/releases", label: "Releases" },
  { href: "/tracks", label: "Tracks" },
  { href: "/library", label: "Library" },
  { href: "/playlists", label: "Playlists" },
  { href: "/history", label: "History" },
];

/** Second row for signed-in account pages. */
export const ACCOUNT_NAV: NavItem[] = [
  { href: "/account", label: "Account" },
  { href: "/tickets", label: "Tickets" },
  { href: "/orders", label: "Orders" },
  { href: "/purchases", label: "Purchases" },
  { href: "/subscriptions", label: "Subscriptions" },
  { href: "/notifications", label: "Notifications" },
  { href: "/organizations", label: "Workspaces" },
  { href: "/royalties", label: "Royalties" },
];

/** Second row for artist pages. */
export const ARTIST_NAV: NavItem[] = [
  { href: "/studio", label: "Studio" },
  { href: "/studio/sales", label: "Sales" },
  { href: "/royalties", label: "Royalties" },
  { href: "/artists/apply", label: "Apply as an artist" },
];

/**
 * Artist Studio navigation (ARTIST_STUDIO_DESIGN_GUIDE section 6): only real routes. Plays are per
 * artist profile (bands have no play page yet). UX only: every page still asks the API.
 */
export function studioNavSections(profiles: { kind: string; id: string; display_name: string }[]): NavSection[] {
  const sections: NavSection[] = [
    {
      label: "Studio",
      items: [
        { href: "/studio", label: "Your music" },
        { href: "/studio/sales", label: "Sales" },
        { href: "/royalties", label: "Royalties" },
      ],
    },
  ];
  const plays = profiles.filter((p) => p.kind === "artist").map((p) => ({ href: `/artists/${p.id}/analytics`, label: p.display_name }));
  if (plays.length > 0) sections.push({ label: "Plays", items: plays });
  return sections;
}

/** Studio's sign-in and join pages sit in the Studio shell but are not one of its sections. */
export function isStudioAuthPath(pathname: string | null | undefined): boolean {
  return isActivePath(pathname, "/studio/sign-in") || isActivePath(pathname, "/studio/join");
}

export type NavFlags = { isArtist?: boolean; hasWorkspace?: boolean };

/** The user's own flags from /me (missing means no). */
export function navFlagsFor(user: { is_artist?: boolean; has_workspace?: boolean } | null | undefined): NavFlags {
  return { isArtist: user?.is_artist === true, hasWorkspace: user?.has_workspace === true };
}

/**
 * Owner, 2026-10-17: fan accounts do not see artist-only or staff-only places. Studio, sales and royalties
 * are for artists, Workspaces for people who belong to one, and "Apply as an artist" only for
 * people who are not artists yet. Menus only: every page still asks the API.
 */
export function filterNavForUser(items: NavItem[], flags: NavFlags): NavItem[] {
  return items.filter((item) => {
    if (item.href === "/organizations") return flags.hasWorkspace === true;
    if (item.href === "/studio" || item.href === "/studio/sales" || item.href === "/royalties") return flags.isArtist === true;
    if (item.href === "/artists/apply") return flags.isArtist !== true;
    return true;
  });
}

/** The full menu (account drawer and phone menu). Guests see Discover and Listen only. */
export function menuSections(signedIn: boolean, flags: NavFlags = {}): NavSection[] {
  const sections: NavSection[] = [
    {
      label: "Discover",
      items: [
        { href: "/events", label: "Events" },
        { href: "/artists", label: "Artists" },
        { href: "/bands", label: "Bands" },
        { href: "/releases", label: "Releases" },
        { href: "/tracks", label: "Tracks" },
        { href: "/store", label: "Store" },
        { href: "/search", label: "Search" },
      ],
    },
    {
      label: "Listen",
      items: [
        { href: "/listen", label: "Listen" },
        { href: "/library", label: "Library" },
        { href: "/playlists", label: "Playlists" },
        { href: "/history", label: "History" },
      ],
    },
  ];
  if (signedIn) {
    sections.push({ label: "You", items: filterNavForUser(ACCOUNT_NAV, flags) });
    // Artists publish from Studio; anyone else can apply to become one (owner, 2026-10-17).
    sections.push({ label: "Artist", items: filterNavForUser(ARTIST_NAV, flags) });
  }
  return sections;
}

/**
 * Staff console sections (the old design's LIVE, MONEY, MARKETING, INSIGHT, ADMIN). Items that
 * were gated before keep the same permission flags; the rest are visible to every staff user.
 */
export function staffNavSections(permissions: string[] | undefined): NavSection[] {
  const flags = staffNavFlags(permissions);
  const money: NavItem[] = [{ href: "/staff/commerce", label: "Commerce" }];
  if (flags.showFinance) money.push({ href: "/staff/finance", label: "Finance" });
  money.push({ href: "/staff/royalties", label: "Royalty ops" });

  const sections: NavSection[] = [
    {
      label: "Live",
      items: [
        { href: "/staff/events", label: "Events" },
        { href: "/staff/venues", label: "Venues" },
      ],
    },
    // Catalog intake and media (URL-06). The API decides who may use each page.
    {
      label: "Catalog",
      items: [
        { href: "/staff/catalog", label: "Releases" },
        { href: "/staff/catalog/artists", label: "Artist applications" },
        { href: "/staff/catalog/processing", label: "Audio processing" },
      ],
    },
    { label: "Money", items: money },
    { label: "Marketing", items: [{ href: "/staff/campaigns", label: "Campaigns" }] },
  ];
  if (flags.showAnalytics) sections.push({ label: "Insight", items: [{ href: "/staff/analytics", label: "Analytics" }] });

  const admin: NavItem[] = [];
  if (flags.showOps) admin.push({ href: "/staff/ops", label: "Ops" }, { href: "/staff/audit", label: "Audit log" });
  if (flags.showUsers) admin.push({ href: "/staff/users", label: "Users" });
  if (flags.showOrgs) admin.push({ href: "/staff/organizations", label: "Organizations" });
  if (admin.length) sections.push({ label: "Admin", items: admin });
  return sections;
}

/** Where "Staff console" opens: the first destination the user's console shows. */
export function staffHomeHref(permissions: string[] | undefined): string {
  return staffNavSections(permissions)[0]?.items[0]?.href ?? "/staff/events";
}

/** "Money / Finance" for the staff top bar, from the most specific matching item. */
export function staffBreadcrumb(pathname: string | null | undefined, sections: NavSection[]): [string, string] | null {
  let best: [string, string, number] | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (isActivePath(pathname, item.href) && (!best || item.href.length > best[2])) {
        best = [section.label, item.label, item.href.length];
      }
    }
  }
  if (best) return [best[0], best[1]];
  if (isActivePath(pathname, "/organizations")) return ["Workspace", "Organizations"];
  return null;
}

/**
 * Whether to offer the staff console. Customers and artists carry no permissions in the seeded
 * roles; anyone with a permission or an organization membership gets the link. Staff URLs stay
 * reachable directly either way, and the API still decides.
 */
export function showStaffEntry(permissions: string[] | undefined, organizationCount: number): boolean {
  return (permissions ?? []).length > 0 || organizationCount > 0;
}

/**
 * The small "Staff only" sign-in link under the menu's Artist section (owner, 2026-10-23): for
 * signed-in people who don't already get the Staff console button. UX only; staff sign-in decides.
 */
export function showStaffSignInLink(signedIn: boolean, permissions: string[] | undefined, organizationCount: number): boolean {
  return signedIn && !showStaffEntry(permissions, organizationCount);
}

/** Two letters for the avatar button: "Tanvir Ops" -> "TO", "nadia@x.test" -> "NA". */
export function initials(name: string | null | undefined, email?: string | null): string {
  const source = (name ?? "").trim();
  if (source) {
    const words = source.split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
    return letters.toUpperCase();
  }
  const local = (email ?? "").split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  return local ? local.slice(0, 2).toUpperCase() : "ME";
}

/** Active state for a nav link: exact match, or a deeper path under it ("/events/1" under "/events"). */
export function isActivePath(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The single active item in a list: the longest matching href. */
export function activeHref(pathname: string | null | undefined, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (isActivePath(pathname, item.href) && (!best || item.href.length > best.length)) best = item.href;
  }
  return best;
}
