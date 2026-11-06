// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ trackGifts: vi.fn() }));
vi.mock("@/features/gifts/api", async (orig) => ({ ...(await orig<typeof import("@/features/gifts/api")>()), ...api }));

import type { GiftCampaignDetail, GiftRecipient } from "@/features/gifts/api";
import { CollectibleTracking } from "./collectible-tracking";

const TRANSITIONS: GiftCampaignDetail["transitions"] = {
  YET_TO_SEND: ["PREPARED"],
  PREPARED: ["YET_TO_SEND", "DISPATCHED"],
  DISPATCHED: ["RECEIVED", "RETURNED", "MISSING"],
  RETURNED: ["PREPARED"],
  MISSING: ["RECEIVED", "PREPARED"],
  RECEIVED: [],
};

function campaign(recipients: GiftRecipient[], canDispatch = true): GiftCampaignDetail {
  const counts = { YET_TO_SEND: 0, PREPARED: 0, DISPATCHED: 0, RECEIVED: 0, RETURNED: 0, MISSING: 0, TOTAL: recipients.length, SCHEDULED: 0 };
  for (const r of recipients) counts[r.status] += 1;
  return {
    id: "c1",
    profile: { kind: "artist", id: "a1", display_name: "MIZULS" },
    title: "Chaya Pore collectible",
    gift_items: "A signed card",
    sender: "ARTIST",
    include_presale: true,
    works: [],
    status: "ACTIVE",
    counts,
    viewer_role: "owner",
    can_dispatch: canDispatch,
    shows_contact: true,
    transitions: TRANSITIONS,
    recipients,
  };
}

const people: GiftRecipient[] = [
  { id: "r1", status: "YET_TO_SEND", has_account: true, name: "Rumi" },
  { id: "r2", status: "YET_TO_SEND", has_account: false, name: "Nila" },
  { id: "r3", status: "PREPARED", has_account: true, name: "Tushar", prepared_at: "2026-11-06T10:00:00Z" },
];

beforeEach(() => api.trackGifts.mockReset());
afterEach(cleanup);

describe("CollectibleTracking", () => {
  it("shows every status with its count, and marks all not prepared as prepared in one click", async () => {
    const onChange = vi.fn();
    api.trackGifts.mockResolvedValue({ ...campaign(people.map((p) => ({ ...p, status: "PREPARED" }))), moved: 2, skipped: 0 });
    render(<CollectibleTracking c={campaign(people)} onChange={onChange} />);
    for (const label of ["Not prepared", "Prepared", "Dispatched", "Received", "Returned", "Missing"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    await act(async () => screen.getByRole("button", { name: /Mark all 2 not prepared as prepared/ }).click());
    expect(api.trackGifts).toHaveBeenCalledWith("c1", { to: "PREPARED", every: "YET_TO_SEND" });
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("2 gifts marked prepared.");
  });

  it("offers only the moves the chosen gifts allow, and dispatches now", async () => {
    api.trackGifts.mockResolvedValue({ ...campaign(people), moved: 1, skipped: 0 });
    render(<CollectibleTracking c={campaign(people)} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Choose Tushar"));
    expect(screen.queryByRole("button", { name: /Mark received/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Mark not prepared 1/ })).toBeTruthy();
    expect(screen.getByText(/emails each buyer that their gift is on its way/)).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: /Dispatch 1/ }).click());
    expect(api.trackGifts).toHaveBeenCalledWith("c1", { to: "DISPATCHED", recipient_ids: ["r3"] });
  });

  it("schedules a dispatch at a chosen Bangladesh time, never one already gone", async () => {
    api.trackGifts.mockResolvedValue({ ...campaign(people), moved: 1, skipped: 0 });
    render(<CollectibleTracking c={campaign(people)} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Choose Tushar"));
    fireEvent.click(screen.getByLabelText(/At a time I choose/));
    const at = screen.getByLabelText("Dispatch at");
    fireEvent.change(at, { target: { value: "2020-01-01T10:00" } });
    expect((screen.getByRole("button", { name: /Schedule 1/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(at, { target: { value: "2099-01-01T10:00" } });
    await act(async () => screen.getByRole("button", { name: /Schedule 1/ }).click());
    expect(api.trackGifts).toHaveBeenCalledWith("c1", { to: "DISPATCHED", recipient_ids: ["r3"], dispatch_at: "2099-01-01T10:00:00+06:00" });
  });

  it("shows a scheduled dispatch in Bangladesh time, the time it was chosen in", () => {
    const later: GiftRecipient = { id: "r4", status: "PREPARED", has_account: true, name: "Mitu", dispatch_at: "2026-11-08T04:00:00Z" };
    render(<CollectibleTracking c={campaign([...people, later])} onChange={() => {}} />);
    const row = screen.getByText("Mitu").closest("tr") as HTMLElement;
    expect(row.textContent).toContain("10:00");
    expect(row.textContent).toContain("Dhaka time");
  });

  it("filters the list by status from the tiles", () => {
    render(<CollectibleTracking c={campaign(people)} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Prepared/ }));
    expect(screen.queryByText("Rumi")).toBeNull();
    expect(screen.getByText("Tushar")).toBeTruthy();
  });

  it("is read-only when Corner Room sends the gifts", () => {
    render(<CollectibleTracking c={campaign(people, false)} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /Mark all/ })).toBeNull();
    expect(screen.queryByLabelText("Choose Tushar")).toBeNull();
    expect(screen.getByText(/Corner Room's team sends these gifts/)).toBeTruthy();
  });
});
