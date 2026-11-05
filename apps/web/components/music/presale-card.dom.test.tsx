// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ status: "authenticated" as string }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ status: auth.status, user: null }) }));
const counts = vi.hoisted(() => ({ countPresale: vi.fn() }));
vi.mock("@/features/presales/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/presales/api")>()), ...counts }));

import type { PresalePageRecord } from "@/features/catalog/api";
import { PresaleCard } from "./presale-card";
import { PresaleCover } from "./presale-cover";

const SOON = new Date(Date.now() + 6 * 86_400_000 + 3_600_000).toISOString();

function presale(over: Partial<PresalePageRecord> = {}): PresalePageRecord {
  return {
    id: "r1",
    title: "Night Signal",
    release_type: "SINGLE",
    release_at: SOON,
    artist: "Early Act",
    artist_kind: "artist",
    artist_id: "a1",
    cover_url: null,
    offer: { id: "o1", amount_minor: 150000, currency_code: "BDT" },
    open: true,
    ...over,
  };
}

beforeEach(() => {
  counts.countPresale.mockReset();
  auth.status = "authenticated";
  sessionStorage.clear();
});
afterEach(cleanup);

describe("Pre-sale cover (D-PRESALE-04)", () => {
  it("shows the title screen, sharp, when there is no cover", () => {
    const { container } = render(<PresaleCover coverUrl={null} title="Night Signal" artist="Early Act" />);
    const frame = container.querySelector(".psc")!;
    expect(frame.getAttribute("data-kind")).toBe("screen");
    expect(container.querySelector(".psc-screen .psc-tube .psc-gloss")).not.toBeNull();
    expect(container.querySelector(".psc-art")).toBeNull();
  });

  it("puts a shown cover under the light blur layer", () => {
    const { container } = render(<PresaleCover coverUrl="/api/v1/covers/x.webp" title="Night Signal" />);
    expect(container.querySelector(".psc")!.getAttribute("data-kind")).toBe("art");
    expect(container.querySelector(".psc-art img")).not.toBeNull();
  });
});

describe("Pre-sale card (D-PRESALE-04)", () => {
  it("is marked as a pre-sale with the time left and counts a Pre-book press with its place", () => {
    render(<PresaleCard presale={presale()} place="STORE" />);
    expect(screen.getByText("Pre-sale")).toBeTruthy();
    expect(screen.getByText(/Out in 6 days/)).toBeTruthy();
    const buttons = screen.getAllByRole("link", { name: "Pre-book Night Signal" });
    expect(buttons[0].getAttribute("href")).toBe("/checkout?offer=o1");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(counts.countPresale).toHaveBeenCalledWith("r1", { kind: "prebook", place: "STORE" });
  });

  it("remembers where the card was opened for the page's own count", () => {
    render(<PresaleCard presale={presale()} place="PROFILE" />);
    fireEvent.click(screen.getByRole("link", { name: "View pre-sale for Night Signal" }));
    expect(sessionStorage.getItem("cr-presale-place:r1")).toBe("PROFILE");
    expect(counts.countPresale).not.toHaveBeenCalled();
  });

  it("sends signed-out fans through sign-in", () => {
    auth.status = "anonymous";
    render(<PresaleCard presale={presale()} place="HOME" />);
    const link = screen.getAllByRole("link", { name: "Sign in to pre-book Night Signal" })[0];
    expect(link.getAttribute("href")).toBe(`/login?next=${encodeURIComponent("/checkout?offer=o1")}`);
  });

  it("says coming soon without a button once pre-orders close", () => {
    render(<PresaleCard presale={presale({ open: false })} place="RELEASES" />);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Pre-book/ })).toBeNull();
  });
});
