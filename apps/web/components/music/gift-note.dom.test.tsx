// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchPublicGifts: vi.fn() }));
vi.mock("@/features/gifts/api", () => api);
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ status: "authenticated" }) }));

import { GiftNote } from "./gift-note";

const commerce = {
  ready: true,
  entitlements: [],
  offers: [{ id: "o1", product_type: "TRACK", subject_id: "t1", audience: "EVERYONE", status: "ACTIVE", amount_minor: 3000, currency_code: "BDT" }],
  streamable: new Set<string>(),
} as never;

afterEach(cleanup);

describe("GiftNote (owner, 2026-11-21)", () => {
  it("says a collectible comes with the music in one line, never what it is", async () => {
    // Even if an older server still sent the gift, the page draws none of it.
    api.fetchPublicGifts.mockResolvedValue([{ id: "g1", artist: "MIZULS", gift_items: "Postcard", title: "Postcard drop" }]);
    render(<GiftNote show="collectible" trackId="t1" commerce={commerce} owned title="Chhaya Pore" />);
    expect(await screen.findByText(/Comes with a collectible from/)).toBeTruthy();
    expect(screen.getByText("MIZULS")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Postcard|gift/i);
    expect(screen.queryByText("Give it to someone")).toBeNull();
  });

  it("gives an owner one Give it to someone pill, apart from the collectible", async () => {
    api.fetchPublicGifts.mockClear();
    render(<GiftNote show="give" trackId="t1" commerce={commerce} owned title="Chhaya Pore" />);
    const link = await screen.findByRole("link", { name: "Give Chhaya Pore as a gift" });
    expect(link.getAttribute("href")).toBe("/checkout?offer=o1&gift=1");
    expect(link.textContent).toBe("Give it to someone");
    expect(api.fetchPublicGifts).not.toHaveBeenCalled();
  });

  it("draws nothing for someone who doesn't own the music", () => {
    const { container } = render(<GiftNote show="give" trackId="t1" commerce={commerce} title="Chhaya Pore" />);
    expect(container.textContent).toBe("");
  });
});
