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
    expect(await screen.findByText(/When a gift is marked dispatched, the buyer gets/)).toBeTruthy();
    expect(within(preview()).getByText("Samiul", { exact: false })).toBeTruthy();
    expect(within(preview()).queryByText(/friend/)).toBeNull();
    // Another buyer: their own name.
    fireEvent.change(screen.getByLabelText("Preview as"), { target: { value: "r2" } });
    expect(within(preview()).getByText("Rumi", { exact: false })).toBeTruthy();
  });

  it("writes a whole email from a template in one click, button included, then sends it for approval", async () => {
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
    expect((screen.getByRole("button", { name: "Send for approval" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Warm thank-you" }));
    // Says plainly that writing never emails a buyer.
    expect(screen.getByText(/None of these buttons emails a buyer/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    });
    expect(api.saveStatusMail).toHaveBeenCalledWith("c1", "DISPATCHED", expect.objectContaining({ button_label: null, button_url: null }));
    expect(api.submitStatusMail).toHaveBeenCalledWith("c1", "DISPATCHED");
    expect(screen.getByRole("status").textContent).toMatch(/Gift dispatched: Sent to Corner Room for approval. Nobody was emailed/);
    // The steps say where it stands.
    expect(screen.getByText(/Waiting for Corner Room. Buyers get the email in use until then/)).toBeTruthy();
  });

  it("puts the email in use at once for someone who approves their own", async () => {
    api.fetchStatusMails.mockResolvedValue(mails({ approves_at_once: true }));
    api.saveStatusMail.mockResolvedValue(mails({ approves_at_once: true }, { state: "DRAFT", subject: "s", body: "b" }));
    api.submitStatusMail.mockResolvedValue(
      mails({ approves_at_once: true }, { state: "APPROVED", subject: "Off it goes", body: "b", live: true, live_subject: "Off it goes", live_body: "b" }),
    );
    render(<StatusEmails campaignId="c1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Warm thank-you" }));
    expect(screen.queryByRole("button", { name: "Send for approval" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Use this email" }));
    });
    expect(screen.getByRole("status").textContent).toMatch(/Approved and in use. From now on every buyer whose gift is marked dispatched gets this email. Nobody was emailed/);
    expect(screen.getByText("Your approved email")).toBeTruthy();
    expect(screen.getAllByText(/“Off it goes”/).length).toBeGreaterThan(0);
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
    expect(screen.getByRole("status").textContent).toMatch(/Test sent to you at band@example.com, written as Samiul Islam will see it. No buyer was emailed/);
  });

  it("emails chosen buyers whose gift is in that status after a check, and shows each one's delivery", async () => {
    api.fetchStatusMails.mockResolvedValue(mails());
    const queued = { recipient_id: "r1", gift_status: "DISPATCHED" as const, state: "PENDING" as const, queued_at: "2026-11-08T08:00:00Z", sent_at: null };
    api.sendStatusMail.mockResolvedValue({ ...mails({ history: [queued] }), sent: 1, skipped: 0 });
    render(<StatusEmails campaignId="c1" />);
    await screen.findByText("Email buyers now");
    // Only Samiul's gift is dispatched, and nobody has been emailed yet.
    expect(screen.getByRole("checkbox", { name: /Samiul Islam/ })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /Rumi Das/ })).toBeNull();
    expect(screen.getByText("Not emailed yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Samiul Islam/ }));
    fireEvent.click(screen.getByRole("button", { name: /Email 1 buyer now/ }));
    // Nothing goes until the check is answered.
    expect(api.sendStatusMail).not.toHaveBeenCalled();
    expect(screen.getByText(/now\?$/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Yes, email them now/ }));
    });
    expect(api.sendStatusMail).toHaveBeenCalledWith("c1", "DISPATCHED", ["r1"]);
    expect(screen.getByRole("status").textContent).toMatch(/Emailed 1 buyer \(Samiul Islam\)/);
    expect(screen.getAllByText(/On its way/).length).toBeGreaterThan(0);
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
    expect(screen.getByRole("status").textContent).toMatch(/Approved. This version is in use from now on/);
    expect(screen.getByText("Your approved email")).toBeTruthy();
  });
});
