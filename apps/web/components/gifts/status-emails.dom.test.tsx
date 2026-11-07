// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchStatusMails: vi.fn(),
  saveStatusMail: vi.fn(),
  submitStatusMail: vi.fn(),
  reviewStatusMail: vi.fn(),
  resetStatusMail: vi.fn(),
  sendStatusMail: vi.fn(),
  testStatusMail: vi.fn(),
}));
const mail = vi.hoisted(() => ({ fetchMailOverview: vi.fn() }));
vi.mock("@/features/gifts/api", async (orig) => ({ ...(await orig<typeof import("@/features/gifts/api")>()), ...api }));
vi.mock("@/features/artist-mail/api", async (orig) => ({ ...(await orig<typeof import("@/features/artist-mail/api")>()), ...mail }));

import type { StatusMail, StatusMails } from "@/features/gifts/api";
import { StatusEmails } from "./status-emails";

function item(status: StatusMail["status"], over: Partial<StatusMail> = {}): StatusMail {
  return {
    status,
    default_subject: `Default ${status}`,
    default_body: "Hi {first_name}, your {gift} from {artist}.",
    subject: null,
    body: null,
    button_label: null,
    button_url: null,
    file_ids: [],
    state: null,
    review_note: null,
    live: false,
    live_subject: null,
    live_body: null,
    live_button_label: null,
    live_button_url: null,
    live_file_ids: [],
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
    profile: { kind: "band", id: "b1" },
    artist: "MIZULS",
    music: "Chaya Pore",
    viewer_role: "owner",
    fill_ins: ["first_name", "buyer_name", "artist", "music", "gift"],
    items: [item("DISPATCHED", first), item("RETURNED"), item("MISSING")],
    people: [
      { id: "r1", name: "Samiul Islam", status: "DISPATCHED", reachable: true },
      { id: "r2", name: "Rumi Das", status: "PREPARED", reachable: true },
    ],
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  mail.fetchMailOverview.mockReset();
  mail.fetchMailOverview.mockResolvedValue({ files: [], file_max_bytes: 1000 });
});
afterEach(cleanup);

const preview = () => screen.getByRole("region", { name: "Preview of the email" });

describe("StatusEmails (D-CAMPAIGN-05, D-CAMPAIGN-06)", () => {
  it("previews the email as a real buyer, greeted by their own name", async () => {
    api.fetchStatusMails.mockResolvedValue(mails());
    render(<StatusEmails campaignId="c1" />);
    expect(await screen.findByText("Gift dispatched")).toBeTruthy();
    expect(within(preview()).getByText("Samiul", { exact: false })).toBeTruthy();
    expect(within(preview()).queryByText(/friend/)).toBeNull();
    // Another buyer: their own name.
    fireEvent.change(screen.getByLabelText("Preview as"), { target: { value: "r2" } });
    expect(within(preview()).getByText("Rumi", { exact: false })).toBeTruthy();
  });

  it("writes a whole email from a template in one click, button included, then sends it for review", async () => {
    api.fetchStatusMails.mockResolvedValue(mails());
    api.saveStatusMail.mockResolvedValue(mails({}, { state: "DRAFT", subject: "s", body: "b" }));
    api.submitStatusMail.mockResolvedValue(mails({}, { state: "IN_REVIEW", subject: "s", body: "b" }));
    render(<StatusEmails campaignId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Warm thank-you" }));
    expect(within(preview()).getByText(/has just left us/)).toBeTruthy();
    // The tracking one needs the courier's name and the button's link before it can go.
    fireEvent.click(screen.getByRole("button", { name: "With tracking" }));
    expect(screen.getByText(/Fill in \[add the courier's name\]/)).toBeTruthy();
    expect(screen.getByText(/Add the web address the button opens/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send for review" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Warm thank-you" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    });
    expect(api.saveStatusMail).toHaveBeenCalledWith("c1", "DISPATCHED", expect.objectContaining({ button_label: null, button_url: null }));
    expect(api.submitStatusMail).toHaveBeenCalledWith("c1", "DISPATCHED");
    expect(screen.getByText(/Gift dispatched: Sent to Corner Room for review/)).toBeTruthy();
  });

  it("sends a test written as the previewed buyer", async () => {
    api.fetchStatusMails.mockResolvedValue(mails());
    api.testStatusMail.mockResolvedValue({ sent_to: "band@example.com" });
    render(<StatusEmails campaignId="c1" />);
    const test = await screen.findByRole("button", { name: "Send me a test" });
    await act(async () => {
      fireEvent.click(test);
    });
    expect(api.testStatusMail).toHaveBeenCalledWith("c1", "DISPATCHED", expect.objectContaining({ recipient_id: "r1" }));
    expect(screen.getByText(/written as Samiul Islam will see it, is on its way to band@example.com/)).toBeTruthy();
  });

  it("emails chosen buyers whose gift is in that status", async () => {
    api.fetchStatusMails.mockResolvedValue(mails());
    api.sendStatusMail.mockResolvedValue({ ...mails(), sent: 1, skipped: 0 });
    render(<StatusEmails campaignId="c1" />);
    await screen.findByText("Email chosen buyers now");
    // Only Samiul's gift is dispatched.
    expect(screen.getByRole("checkbox", { name: "Samiul Islam" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Rumi Das" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Samiul Islam" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Email 1 buyer now/ }));
    });
    expect(api.sendStatusMail).toHaveBeenCalledWith("c1", "DISPATCHED", ["r1"]);
    expect(screen.getByText(/emailed 1 buyer now/)).toBeTruthy();
  });

  it("lets staff approve, and needs a note to send back", async () => {
    api.fetchStatusMails.mockResolvedValue(mails({ viewer_role: "staff" }, { subject: "Off it goes", body: "Hi!", state: "IN_REVIEW", can_review: true }));
    api.reviewStatusMail.mockResolvedValue(mails({ viewer_role: "staff" }, { live: true, live_subject: "Off it goes", live_body: "Hi!", state: "APPROVED", subject: "Off it goes", body: "Hi!" }));
    render(<StatusEmails campaignId="c1" />);
    const back = await screen.findByRole("button", { name: "Send back" });
    expect((back as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    expect(api.reviewStatusMail).toHaveBeenCalledWith("c1", "DISPATCHED", "approve");
    expect(screen.getByText("Your email sends.")).toBeTruthy();
  });
});
