// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ addGiftPeople: vi.fn(), reviewGiftPeople: vi.fn(), removeGiftPerson: vi.fn() }));
vi.mock("@/features/gifts/api", async (orig) => ({ ...(await orig<typeof import("@/features/gifts/api")>()), ...api }));

import type { GiftCampaignDetail, GiftRecipient } from "@/features/gifts/api";
import { AddPeople } from "./add-people";
import { WaitingPeople } from "./waiting-people";

function campaign(over: Partial<GiftCampaignDetail> = {}): GiftCampaignDetail {
  return {
    id: "c1",
    profile: { kind: "band", id: "b1", display_name: "MIZULS" },
    title: "Chaya Pore collectible",
    gift_items: "A signed card",
    sender: "ARTIST",
    include_presale: true,
    works: [],
    status: "ACTIVE",
    counts: { YET_TO_SEND: 0, PREPARED: 0, DISPATCHED: 0, RECEIVED: 0, RETURNED: 0, MISSING: 0, TOTAL: 0, SCHEDULED: 0, WAITING: 0 },
    viewer_role: "owner",
    can_dispatch: true,
    shows_contact: true,
    transitions: {},
    recipients: [],
    can_add: true,
    can_review: false,
    waiting: [],
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(cleanup);

describe("AddPeople", () => {
  it("reads pasted sheet rows, previews them, and sends only the good ones", async () => {
    api.addGiftPeople.mockResolvedValue({ ...campaign(), added: 1, skipped: 0 });
    const onChange = vi.fn();
    render(<AddPeople c={campaign()} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Add people/ }));
    fireEvent.change(screen.getByLabelText("Paste rows from a sheet"), {
      target: { value: "Name\tEmail\tPhone\tAddress\nNila Akter\tnila@example.com\t01712345678\tHouse 2, Dhaka\nNo Contact\t\t\tSomewhere" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read the rows" }));
    expect(screen.getByText("Nila Akter")).toBeTruthy();
    expect(screen.getByText("Needs an email or a phone")).toBeTruthy();
    expect(screen.getByText(/1 row needs fixing/)).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: /Add 1 person/ }).click());
    expect(api.addGiftPeople).toHaveBeenCalledWith("c1", [{ name: "Nila Akter", email: "nila@example.com", phone: "01712345678", address: "House 2, Dhaka" }]);
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("They count once Corner Room approves them.");
  });

  it("adds one person typed in, phone only", () => {
    render(<AddPeople c={campaign({ viewer_role: "staff", can_review: true })} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Add people/ }));
    expect(screen.getByText(/They count at once/)).toBeTruthy();
    const put = screen.getByRole("button", { name: "Put on the list" }) as HTMLButtonElement;
    expect(put.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Paid By Hand" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "01812345678" } });
    fireEvent.click(put);
    expect(screen.getByText("Paid By Hand")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add 1 person/ })).toBeTruthy();
  });

  it("isn't offered before the campaign has been live", () => {
    render(<AddPeople c={campaign({ can_add: false })} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /Add people/ })).toBeNull();
  });
});

describe("WaitingPeople", () => {
  const waiting: GiftRecipient[] = [
    { id: "w1", status: "YET_TO_SEND", source: "ADDED", has_account: true, name: "Linked Fan", email: "linked@example.com", phone: null, address: "Road 2" },
    { id: "w2", status: "YET_TO_SEND", source: "ADDED", has_account: false, name: "Phone Only", email: null, phone: "01712345678", address: null },
  ];

  it("lets staff approve or turn away the chosen people", async () => {
    api.reviewGiftPeople.mockResolvedValue(campaign());
    render(<WaitingPeople c={campaign({ viewer_role: "staff", can_review: true, waiting })} onChange={() => {}} />);
    expect(screen.getByText("Waiting for Corner Room (2)")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Choose Linked Fan"));
    await act(async () => screen.getByRole("button", { name: /Approve 1/ }).click());
    expect(api.reviewGiftPeople).toHaveBeenCalledWith("c1", ["w1"], "approve");
  });

  it("shows the act its additions as waiting, with a way to take one back", async () => {
    api.removeGiftPerson.mockResolvedValue(campaign());
    render(<WaitingPeople c={campaign({ waiting })} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    await act(async () => screen.getAllByRole("button", { name: "Take back" })[1].click());
    expect(api.removeGiftPerson).toHaveBeenCalledWith("c1", "w2");
  });
});
