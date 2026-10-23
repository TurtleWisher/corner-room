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

  it("lets owners play (no player here, so it links to the song)", () => {
    auth.status = "authenticated";
    const owned = [{ id: "e1", scope: "TRACK", ref_id: "t1", status: "ACTIVE" }] as unknown as CustomerCommerce["entitlements"];
    render(<TrackBuyControl track={track} commerce={commerce(owned)} />);
    expect(screen.getByRole("link", { name: /Owned/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Locked/ })).toBeNull();
  });
});
