// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchStatusMails: vi.fn(),
  saveStatusMail: vi.fn(),
  submitStatusMail: vi.fn(),
  reviewStatusMail: vi.fn(),
  resetStatusMail: vi.fn(),
}));
vi.mock("@/features/gifts/api", async (orig) => ({ ...(await orig<typeof import("@/features/gifts/api")>()), ...api }));

import type { StatusMail, StatusMails } from "@/features/gifts/api";
import { StatusEmails } from "./status-emails";

function item(status: StatusMail["status"], over: Partial<StatusMail> = {}): StatusMail {
  return {
    status,
    default_subject: `Default ${status}`,
    default_body: "Hi {first_name}, your {gift} from {artist}.",
    subject: null,
    body: null,
    state: null,
    review_note: null,
    live: false,
    live_subject: null,
    live_body: null,
    sent_count: 0,
    submitted_at: null,
    approved_at: null,
    can_review: false,
    ...over,
  };
}

function mails(over: Partial<StatusMails> = {}, first: Partial<StatusMail> = {}): StatusMails {
  return {
    campaign: { id: "c1", title: "Chaya Pore collectible", gift_items: "A signed card", status: "ACTIVE" },
    artist: "MIZULS",
    music: "Chaya Pore",
    viewer_role: "owner",
    fill_ins: ["first_name", "buyer_name", "artist", "music", "gift"],
    items: [item("DISPATCHED", first), item("RETURNED"), item("MISSING")],
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(cleanup);

describe("StatusEmails (D-CAMPAIGN-05)", () => {
  it("shows Corner Room's wording as a buyer reads it, with the gift filled in", async () => {
    api.fetchStatusMails.mockResolvedValue(mails());
    render(<StatusEmails campaignId="c1" />);
    expect(await screen.findByText("Gift dispatched")).toBeTruthy();
    expect(screen.getAllByText("Corner Room's wording")).toHaveLength(3);
    expect(screen.getAllByText("Hi friend, your A signed card from MIZULS.")).toHaveLength(3);
  });

  it("sends the artist's draft for review and says so", async () => {
    api.fetchStatusMails.mockResolvedValue(mails({}, { subject: "Off it goes", body: "Hi {first_name}!", state: "DRAFT" }));
    api.submitStatusMail.mockResolvedValue(mails({}, { subject: "Off it goes", body: "Hi {first_name}!", state: "IN_REVIEW" }));
    render(<StatusEmails campaignId="c1" />);
    expect(await screen.findByText("Your draft, not sent for review")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    });
    expect(api.submitStatusMail).toHaveBeenCalledWith("c1", "DISPATCHED");
    expect(screen.getByText("Waiting for Corner Room")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Gift dispatched: Sent to Corner Room for review/);
  });

  it("lets staff approve, and needs a note to send back", async () => {
    api.fetchStatusMails.mockResolvedValue(
      mails({ viewer_role: "staff" }, { subject: "Off it goes", body: "Hi!", state: "IN_REVIEW", can_review: true }),
    );
    api.reviewStatusMail.mockResolvedValue(mails({ viewer_role: "staff" }, { live: true, live_subject: "Off it goes", live_body: "Hi!", state: "APPROVED" }));
    render(<StatusEmails campaignId="c1" />);
    const back = await screen.findByRole("button", { name: "Send back" });
    expect((back as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    expect(api.reviewStatusMail).toHaveBeenCalledWith("c1", "DISPATCHED", "approve");
    expect(screen.getByText("Your words send.")).toBeTruthy();
  });
});
