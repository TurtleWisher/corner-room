// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventRecord } from "@/lib/api";

const api = vi.hoisted(() => ({ fetchPublicEvents: vi.fn(), fetchEventTicketTypes: vi.fn() }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }));

import WhatsOnPage from "@/app/(public)/events/page";

const ev = (id: string, starts_at: string, status = "TICKETING_OPEN", venue: EventRecord["venue"] = null): EventRecord => ({
  id,
  venue_id: null,
  title: `Show ${id}`,
  description: null,
  status,
  timezone: "Asia/Dhaka",
  starts_at,
  ends_at: null,
  venue,
});

const type = (price: number, status = "ON_SALE") => ({
  id: `t${price}`,
  event_id: "x",
  name: "GA",
  status,
  price_amount_minor: price,
  currency_code: "BDT",
  quantity_total: 100,
  remaining: 50,
  sales_starts_at: null,
  sales_ends_at: null,
});

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-14T00:00:00Z"), toFake: ["Date"] });
  // Reveal waits for an IntersectionObserver jsdom does not have; show everything.
  vi.stubGlobal("IntersectionObserver", undefined);
  api.fetchEventTicketTypes.mockImplementation(async (id: string) => ({
    items: id === "a" ? [type(250000), type(150000)] : id === "b" ? [type(90000)] : [],
    next_cursor: null,
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("What's On", () => {
  it("shows the lowest on-sale price per row and moves ended events to Past", async () => {
    api.fetchPublicEvents.mockResolvedValueOnce({
      items: [ev("a", "2026-10-17T14:00:00Z", "TICKETING_OPEN", { name: "Hall Two", city: "Dhaka" }), ev("b", "2026-10-25T14:00:00Z", "PUBLISHED"), ev("old", "2026-09-01T14:00:00Z", "COMPLETED")],
      next_cursor: null,
    });
    await act(async () => {
      render(<WhatsOnPage />);
    });
    const october = screen.getByRole("list", { name: "Events in October 2026" });
    const rowA = within(october).getByText("Show a").closest("li") as HTMLElement;
    expect(rowA.textContent).toContain("From");
    expect(rowA.textContent).toContain("1,500");
    expect(rowA.textContent).toContain("Hall Two");
    // Announced, not on sale: no price even though a type exists.
    const rowB = within(october).getByText("Show b").closest("li") as HTMLElement;
    expect(rowB.textContent).not.toContain("From");
    const past = screen.getByRole("list", { name: "Past events" });
    expect(within(past).getByText("Show old")).toBeTruthy();
    expect(within(october).queryByText("Show old")).toBeNull();
    // Ended events never ask for prices.
    expect(api.fetchEventTicketTypes).not.toHaveBeenCalledWith("old", expect.anything());
  });

  it("loads the next page on request and keeps the rows it has", async () => {
    api.fetchPublicEvents
      .mockResolvedValueOnce({ items: [ev("a", "2026-10-17T14:00:00Z")], next_cursor: "c2" })
      .mockResolvedValueOnce({ items: [ev("z", "2026-12-05T14:00:00Z")], next_cursor: null });
    await act(async () => {
      render(<WhatsOnPage />);
    });
    expect(screen.queryByText("Show z")).toBeNull();
    await act(async () => screen.getByRole("button", { name: "Show more events" }).click());
    expect(api.fetchPublicEvents).toHaveBeenLastCalledWith("c2");
    expect(screen.getByText("Show a")).toBeTruthy();
    expect(screen.getByText("Show z")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more events" })).toBeNull();
  });
});
