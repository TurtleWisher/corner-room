// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/fan-gifts/api", async (orig) => ({
  ...(await orig<typeof import("@/features/fan-gifts/api")>()),
  previewGiftEmail: vi.fn().mockResolvedValue({ subject: "Samiul sent you Song", html: "<html><body><p>Hi Rumi</p></body></html>", text: "", needs_review: false }),
  fetchOfferCredit: vi.fn().mockResolvedValue({ usable: true, balance: { amount_minor: 11400, currency_code: "BDT" }, act_name: "MIZULS" }),
}));

import { CreditStep, GiftStep, NO_GIFT, readGift, type GiftDraft } from "./gift-step";

function Harness({ own = "me@example.com" }: { own?: string }) {
  const [draft, setDraft] = useState<GiftDraft>(NO_GIFT);
  return <GiftStep draft={draft} onChange={setDraft} ownEmail={own} each={{ amount_minor: 3000, currency_code: "BDT" }} offerId="o1" title="Song" />;
}

afterEach(cleanup);

describe("GiftStep (owner, 2026-11-20, D-GIFT-FAN-01)", () => {
  it("opens the gift form, refuses the giver's own email, counts the people and previews the email", async () => {
    render(<Harness />);
    expect(screen.queryByLabelText("Their email addresses")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Give it as a gift/ }));
    const people = screen.getByLabelText("Their email addresses");
    fireEvent.change(people, { target: { value: "Me@example.com" } });
    expect(screen.getByText(/leave out your own email address/)).toBeTruthy();
    fireEvent.change(people, { target: { value: "rumi@example.com\nNila <nila@example.com>" } });
    expect(screen.queryByText(/your own email/)).toBeNull();
    expect(screen.getByText(/For 2 people,/)).toBeTruthy();
    expect(screen.getByText(/back as credit/)).toBeTruthy();
    // The email preview the server wrote, as Rumi will see it.
    expect(await screen.findByText("Hi Rumi")).toBeTruthy();
    expect(screen.getByText("Samiul sent you Song")).toBeTruthy();
  });

  it("reads the people and the note the server will check", () => {
    const design = { note: "  Hi ", subject: "", look: "SKY" as const, show_cover: true, file_ids: [] };
    const read = readGift({ on: true, peopleText: "a@example.com, b@example.com", design }, null);
    expect(read.people).toEqual([
      { email: "a@example.com", name: null },
      { email: "b@example.com", name: null },
    ]);
    expect(read.note).toBe("Hi");
    expect(read.problem).toBeNull();
    expect(readGift({ on: true, peopleText: "a@example.com", design: { ...design, note: "x".repeat(2001) } }, null).problem).toMatch(/2,000/);
    expect(readGift({ on: true, peopleText: "a@example.com", design: { ...design, subject: "see https://x" } }, null).problem).toMatch(/link/);
  });
});

describe("CreditStep (owner, 2026-11-27, D-GIFT-FAN-03)", () => {
  it("offers the gift credit for a gift too, and says it covers each person", async () => {
    const onChange = vi.fn();
    render(<CreditStep offerId="o1" on={false} onChange={onChange} giving people={2} />);
    const box = await screen.findByRole("checkbox", { name: /Pay for this gift with my gift credit/ });
    expect(screen.getByText(/all 2 of them/)).toBeTruthy();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("keeps the plain wording when buying for yourself", async () => {
    render(<CreditStep offerId="o1" on={false} onChange={() => undefined} />);
    expect(await screen.findByRole("checkbox", { name: /^Pay with my gift credit/ })).toBeTruthy();
  });
});
