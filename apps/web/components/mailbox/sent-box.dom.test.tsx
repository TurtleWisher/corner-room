// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchMailbox: vi.fn(), fetchMailboxMessage: vi.fn() }));
vi.mock("@/features/artist-mail/api", async (orig) => ({ ...(await orig<typeof import("@/features/artist-mail/api")>()), ...api }));

import type { Mailbox, MailboxItem } from "@/features/artist-mail/api";
import { SentBox } from "./sent-box";

const item = (over: Partial<MailboxItem>): MailboxItem => ({
  id: "m1",
  kind: "GIFT_UPDATE",
  subject: "Your signed card is on its way",
  to_name: "Samiul Islam",
  state: "SENT",
  queued_at: new Date().toISOString(),
  sent_at: new Date().toISOString(),
  clicks: 2,
  why: { kind: "GIFT_UPDATE", campaign: "Poster", gift_status: "DISPATCHED", picked: true },
  ...over,
});
const box = (items: MailboxItem[]): Mailbox => ({
  items,
  next_before: null,
  totals: { THANK_YOU: 0, MANUAL: 1, GIFT: 0, GIFT_UPDATE: 1, TEST: 0 },
});

beforeEach(() => {
  api.fetchMailbox.mockReset();
  api.fetchMailboxMessage.mockReset();
});
afterEach(cleanup);

describe("Mailbox Sent (D-MAILBOX-01)", () => {
  it("lists each email with whom, why and whether it went, and opens it to read", async () => {
    api.fetchMailbox.mockResolvedValue(
      box([item({}), item({ id: "m2", kind: "MANUAL", subject: "New single", to_name: "Rumi Das", state: "FAILED", clicks: 0, why: { kind: "MANUAL", mail_subject: "New single" } })]),
    );
    api.fetchMailboxMessage.mockResolvedValue({
      id: "m1",
      kind: "GIFT_UPDATE",
      subject: "Your signed card is on its way",
      from_name: "MIZULS via Corner Room",
      to_name: "Samiul Islam",
      body: "Hi Samiul, track it at (link).",
      state: "SENT",
      queued_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      clicks: 2,
      links: [{ label: "Track your parcel", kind: "LINK" }],
      campaign_id: "c1",
      gift_status: "DISPATCHED",
      mail_id: null,
      music_gift_id: null,
    });
    render(<SentBox profile={{ kind: "band", id: "b1" }} artist="MIZULS" />);
    expect(await screen.findByText("Samiul Islam")).toBeTruthy();
    expect(screen.getByText(/Poster: gift on its way, to buyers you picked/)).toBeTruthy();
    expect(screen.getAllByText("Couldn't send").length).toBe(2);
    await act(async () => {
      fireEvent.click(screen.getByText("Samiul Islam"));
    });
    const reading = await screen.findByRole("article", { name: "The email" });
    expect(await within(reading).findByText("MIZULS via Corner Room")).toBeTruthy();
    expect(within(reading).getByText(/Hi Samiul/)).toBeTruthy();
    expect(within(reading).getByText("Track your parcel")).toBeTruthy();
    expect(within(reading).getByRole("link", { name: /Open the gift campaign/ }).getAttribute("href")).toBe("/studio/gifts/c1#emails");
  });

  it("asks the server again for a search and for a kind", async () => {
    api.fetchMailbox.mockResolvedValue(box([item({})]));
    render(<SentBox profile={{ kind: "band", id: "b1" }} artist="MIZULS" />);
    await screen.findByText("Samiul Islam");
    fireEvent.click(screen.getByRole("button", { name: /^Gift updates/ }));
    await act(async () => {});
    expect(api.fetchMailbox).toHaveBeenLastCalledWith({ kind: "band", id: "b1" }, expect.objectContaining({ kinds: ["GIFT_UPDATE"] }));
    fireEvent.change(screen.getByLabelText("Search sent emails"), { target: { value: "samiul" } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(api.fetchMailbox).toHaveBeenLastCalledWith({ kind: "band", id: "b1" }, expect.objectContaining({ q: "samiul" }));
  });
});
