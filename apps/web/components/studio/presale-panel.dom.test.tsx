// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ requestPresale: vi.fn(), withdrawPresale: vi.fn(), savePresaleEmail: vi.fn(), submitPresaleEmail: vi.fn() }));
vi.mock("@/features/studio/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/studio/api")>()), ...api }));

import type { StudioPresale, StudioReleaseDetail } from "@/features/studio/api";
import { PresalePanel } from "./presale-panel";

const BASE: StudioPresale = {
  status: null,
  requested_release_at: null,
  release_at: null,
  note: null,
  requested_at: null,
  decided_at: null,
  price: { status: "PROPOSED", amount_minor: 15000, currency_code: "BDT" },
  price_live: false,
  listed: false,
  open: false,
  can_request: true,
  can_withdraw: false,
  email: null,
};

function detail(presale: Partial<StudioPresale>, status = "IDEA"): StudioReleaseDetail {
  return {
    release: { id: "r1", title: "Night Signal", release_type: "SINGLE", status, version: 2, release_at: null },
    profile: { kind: "artist", id: "a1", display_name: "Early Act" },
    presale: { ...BASE, ...presale },
  } as unknown as StudioReleaseDetail;
}

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));
afterEach(cleanup);

describe("Pre-sale panel (DOM)", () => {
  it("sends the pre-sale with a date in Bangladesh time", async () => {
    api.requestPresale.mockResolvedValue(detail({ status: "REQUESTED", can_request: false, can_withdraw: true }));
    const reload = vi.fn();
    render(<PresalePanel detail={detail({})} reload={reload} priceRow={<p>price row</p>} />);
    fireEvent.change(screen.getByLabelText(/When it comes out/), { target: { value: "2026-11-20T20:00" } });
    fireEvent.click(screen.getByRole("button", { name: /Send pre-sale for review/ }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(api.requestPresale).toHaveBeenCalledWith("r1", "2026-11-20T20:00:00+06:00");
  });

  it("asks for a pre-sale price first", () => {
    render(<PresalePanel detail={detail({ price: null })} reload={vi.fn()} priceRow={<p>price row</p>} />);
    expect(screen.getByText("Propose a pre-sale price above first.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Send pre-sale for review/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the fan preview with only title, artist, date and price", () => {
    render(<PresalePanel detail={detail({ status: "REQUESTED", requested_release_at: "2026-11-20T14:00:00Z", can_request: false, can_withdraw: true })} reload={vi.fn()} priceRow={null} />);
    expect(screen.getByText("Fan preview")).toBeTruthy();
    expect(screen.getAllByText("Night Signal").length).toBeGreaterThan(0);
    expect(screen.getByText("Pre-book the single", { exact: false })).toBeTruthy();
    expect(screen.getByText(/Waiting for Corner Room/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Take the pre-sale back/ })).toBeTruthy();
  });

  it("says when it is live and links the page; sent back shows the note", () => {
    render(<PresalePanel detail={detail({ status: "APPROVED", release_at: "2026-11-20T14:00:00Z", listed: true, open: true, can_request: false })} reload={vi.fn()} priceRow={null} />);
    expect(screen.getByText(/Your pre-sale is live/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open your pre-sale page/ }).getAttribute("href")).toBe("/releases/r1");
    cleanup();
    render(<PresalePanel detail={detail({ status: "RETURNED", note: "Pick an evening time" })} reload={vi.fn()} priceRow={null} />);
    expect(screen.getByText(/Pick an evening time/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send the pre-sale again/ })).toBeTruthy();
  });

  it("saves the release-day email, then sends it to Corner Room", async () => {
    const saved = detail({ email: { id: "m1", subject: "It's out", body: "Thanks", status: "DRAFT", review_note: null, submitted_at: null, approved_at: null, sent_at: null, recipient_count: null } });
    api.savePresaleEmail.mockResolvedValue(saved);
    const reload = vi.fn();
    render(<PresalePanel detail={detail({})} reload={reload} priceRow={null} />);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "It's out" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.savePresaleEmail).toHaveBeenCalledWith("r1", { subject: "It's out", body: "Thanks" }));
    cleanup();
    api.submitPresaleEmail.mockResolvedValue(saved);
    render(<PresalePanel detail={saved} reload={reload} priceRow={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Send to Corner Room/ }));
    await waitFor(() => expect(api.submitPresaleEmail).toHaveBeenCalledWith("r1"));
  });
});
