// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchCampaignNumbers: vi.fn() }));
vi.mock("@/features/presales/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/presales/api")>()), ...api }));

import type { CampaignNumbers, CampaignView } from "@/features/presales/api";
import { CampaignNumbersPanel } from "./campaign-numbers";

function view(orders: number, over: Partial<CampaignView> = {}): CampaignView {
  return {
    views: 0, prebook_clicks: 0, checkout_started: orders, orders, free_copies: 0, refunded_orders: 0, buyers: orders,
    conversion_bps: null, money: null, places: [], links: [], sites: [], timeline: [], ...over,
  };
}

function numbers(over: Partial<CampaignNumbers> = {}): CampaignNumbers {
  return {
    release_id: "r1", title: "Night Signal", release_status: "IN_PRODUCTION", release_at: null, released_at: null, had_presale: true,
    money_visible: true, as_of: "2026-11-06T12:00:00Z",
    presale: view(200, { views: 1000, conversion_bps: 2000, money: [{ currency_code: "BDT", gross_amount_minor: 30000000, refunded_amount_minor: 0, net_amount_minor: 30000000 }] }),
    since_release: null, all: view(200), milestones: [], ...over,
  };
}

beforeEach(() => api.fetchCampaignNumbers.mockReset());
afterEach(cleanup);

describe("Campaign numbers (D-PRESALE-04)", () => {
  it("shows the pre-sale's numbers, with conversion and money from the API", async () => {
    api.fetchCampaignNumbers.mockResolvedValue(numbers());
    render(<CampaignNumbersPanel releaseId="r1" />);
    await waitFor(() => expect(screen.getByText("Pre-orders")).toBeTruthy());
    expect(screen.getByText("Pre-sale only")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Which numbers" })).toBeNull();
  });

  it("switches between pre-sale, since release and all together after release", async () => {
    api.fetchCampaignNumbers.mockResolvedValue(
      numbers({ released_at: "2026-11-12T12:00:00Z", release_status: "RELEASED", since_release: view(30), all: view(230) }),
    );
    render(<CampaignNumbersPanel releaseId="r1" />);
    await waitFor(() => expect(screen.getByRole("group", { name: "Which numbers" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "All together" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByText("230").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Pre-sale only" }));
    expect(screen.getByText("Pre-orders")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Since release" }));
    expect(screen.getByText("Orders since release")).toBeTruthy();
  });

  it("says Not available, never 0, for what the API can't give", async () => {
    api.fetchCampaignNumbers.mockResolvedValue(numbers({ money_visible: false, presale: view(0) }));
    render(<CampaignNumbersPanel releaseId="r1" />);
    await waitFor(() => expect(screen.getByText("Pre-orders")).toBeTruthy());
    expect(screen.getAllByText("Not available").length).toBe(2); // conversion and money
    expect(screen.getByText(/Only the artist's team and finance staff see money/)).toBeTruthy();
  });
});
