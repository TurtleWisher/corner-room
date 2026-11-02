// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "anonymous" as string }));
const commerce = vi.hoisted(() => ({ ready: false, entitlements: [] as unknown[] }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ status: auth.status, user: null }) }));
vi.mock("@/components/music/commerce", () => ({ useCustomerCommerce: () => commerce }));
vi.mock("@/lib/ownership", () => ({ ownsRelease: (ents: unknown[]) => ents.length > 0 }));

import type { PresalePageRecord } from "@/features/catalog/api";
import { PresaleView } from "./presale-view";

const PRESALE: PresalePageRecord = {
  id: "r1",
  title: "Chaya Pore",
  release_type: "SINGLE",
  release_at: "2026-11-10T14:00:00Z",
  artist: "MIZULS",
  artist_kind: "band",
  artist_id: "b1",
  cover_url: null,
  offer: { id: "o1", amount_minor: 10000, currency_code: "BDT" },
  open: true,
};

afterEach(() => {
  cleanup();
  auth.status = "anonymous";
  commerce.ready = false;
  commerce.entitlements = [];
});

describe("Pre-sale page (DOM)", () => {
  it("before the reveal: title, artist, date and offer; a closed cover and no songs", () => {
    const { container } = render(<PresaleView presale={PRESALE} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chaya Pore");
    expect(screen.getByText("Pre-sale")).toBeTruthy();
    expect(screen.getByText("The cover is still under wraps.")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("Tracks")).toBeNull();
    expect(screen.getByRole("link", { name: /Sign in to pre-book Chaya Pore/ }).getAttribute("href")).toContain(encodeURIComponent("/checkout?offer=o1"));
    expect(screen.getByText(/unlocks for you on release day/)).toBeTruthy();
  });

  it("signed in: Pre-book goes straight to the payment page", () => {
    auth.status = "authenticated";
    render(<PresaleView presale={PRESALE} />);
    const link = screen.getByRole("link", { name: /Pre-book the single/ });
    expect(link.getAttribute("href")).toBe("/checkout?offer=o1");
  });

  it("a buyer sees their pre-order and its unlock date, not the button", () => {
    auth.status = "authenticated";
    commerce.ready = true;
    commerce.entitlements = [{ id: "e1" }];
    render(<PresaleView presale={PRESALE} />);
    expect(screen.getByRole("status").textContent).toMatch(/You've pre-ordered this\. It unlocks on/);
    expect(screen.queryByRole("link", { name: /Pre-book/ })).toBeNull();
  });

  it("past its date while the music is finished: coming soon, no button", () => {
    render(<PresaleView presale={{ ...PRESALE, open: false }} />);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.getByText(/Pre-orders are closed/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /pre-book/i })).toBeNull();
  });

  it("after the artist reveals it, the cover shows", () => {
    const { container } = render(<PresaleView presale={{ ...PRESALE, cover_url: "/api/v1/covers/signed/t/1200" }} />);
    expect(screen.queryByText("The cover is still under wraps.")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toContain("/api/v1/covers/signed/t/1200");
  });
});
