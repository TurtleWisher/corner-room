// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* The play button for a song (owner, 2026-10-24): "Sign in" for visitors, a lock that opens the
 * purchase page for signed-in people who don't own it, Play for owners. */
const auth = { status: "anonymous" as string };
vi.mock("@/components/auth-provider", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/releases/r1" }));
vi.mock("@/components/music/player", () => ({ useOptionalPlayer: () => null }));

import { TrackBuyControl, type CustomerCommerce } from "./commerce";

const offer = {
  id: "o1",
  organization_id: "org",
  product_id: "p1",
  product_type: "TRACK",
  name: null,
  subject_id: "t1",
  amount_minor: 5000,
  currency_code: "BDT",
  status: "ACTIVE",
  version: 1,
};
const commerce = (entitlements: CustomerCommerce["entitlements"] = []): CustomerCommerce => ({
  offers: [offer],
  entitlements,
  ready: true,
  reload: () => {},
});
const track = { id: "t1", title: "Night Bus", artist: "Kaal Bela" };

afterEach(cleanup);

describe("TrackBuyControl", () => {
  it("shows visitors 'Sign in' and the price, and brings them back to this page", () => {
    auth.status = "anonymous";
    render(<TrackBuyControl track={track} commerce={commerce()} />);
    const link = screen.getByRole("link", { name: "Sign in to play Night Bus" });
    expect(link.textContent).toContain("Sign in");
    expect(link.getAttribute("href")).toBe(`/login?next=${encodeURIComponent("/releases/r1")}`);
    expect(document.body.textContent).toContain("50");
  });

  it("shows signed-in people who don't own it a lock to the purchase page", () => {
    auth.status = "authenticated";
    render(<TrackBuyControl track={track} commerce={commerce()} />);
    const lock = screen.getByRole("link", { name: "Locked. Buy Night Bus to play it" });
    expect(lock.getAttribute("href")).toBe("/checkout?offer=o1");
  });

  it("on a release's own page, a song sold only with that release gets a quiet lock, not a second price", () => {
    auth.status = "authenticated";
    const single = { ...offer, id: "o2", product_type: "RELEASE", subject_id: "r1", amount_minor: 11400 };
    const onlyRelease: CustomerCommerce = { offers: [single], entitlements: [], ready: true, reload: () => {} };
    render(<TrackBuyControl track={track} commerce={onlyRelease} releaseIds={["r1"]} onReleasePage="r1" />);
    expect(screen.getByRole("img", { name: "Night Bus: buy the release above to play it" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    // Anywhere else (a track list, the song's own page) it still offers the release.
    render(<TrackBuyControl track={track} commerce={onlyRelease} releaseIds={["r1"]} />);
    expect(screen.getByRole("link", { name: "Locked. Buy the release with Night Bus to play it" }).getAttribute("href")).toBe("/checkout?offer=o2");
  });

  it("on a song's own page, an album song says 'Buy the album', never a bare 'Release' price (owner, 2026-10-30)", () => {
    auth.status = "authenticated";
    const album = { ...offer, id: "o3", product_type: "RELEASE", subject_id: "r2", name: "Between Midnight & Dawn", release_type: "ALBUM", amount_minor: 11500 };
    render(<TrackBuyControl track={track} commerce={{ offers: [album], entitlements: [], ready: true, reload: () => {} }} releaseIds={["r2"]} />);
    const link = screen.getByRole("link", { name: "Locked. Buy the album with Night Bus to play it" });
    expect(link.textContent?.trim()).toMatch(/^Buy the album/);
    expect(link.textContent).not.toContain("Release");
    expect(link.getAttribute("title")).toBe("Night Bus is sold as part of Between Midnight & Dawn");
  });

  it("lets owners play (no player here, so it links to the song)", () => {
    auth.status = "authenticated";
    const owned = [{ id: "e1", scope: "TRACK", ref_id: "t1", status: "ACTIVE" }] as unknown as CustomerCommerce["entitlements"];
    render(<TrackBuyControl track={track} commerce={commerce(owned)} />);
    expect(screen.getByRole("link", { name: /Owned/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Locked/ })).toBeNull();
  });
});
