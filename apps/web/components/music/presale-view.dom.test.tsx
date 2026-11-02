// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ status: "anonymous", user: null }) }));
vi.mock("@/components/music/commerce", () => ({ useCustomerCommerce: () => ({ ready: false, entitlements: [] }) }));

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
};

afterEach(cleanup);

describe("Pre-sale page (DOM)", () => {
  it("before the reveal: title, artist, date and offer; a closed cover and no songs", () => {
    const { container } = render(<PresaleView presale={PRESALE} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Chaya Pore");
    expect(screen.getByText("The cover is still under wraps.")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("Tracks")).toBeNull();
    expect(screen.getByRole("link", { name: /Sign in to pre-order/ })).toBeTruthy();
  });

  it("after the artist reveals it, the cover shows", () => {
    const { container } = render(<PresaleView presale={{ ...PRESALE, cover_url: "/api/v1/covers/signed/t/1200" }} />);
    expect(screen.queryByText("The cover is still under wraps.")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toContain("/api/v1/covers/signed/t/1200");
  });
});
