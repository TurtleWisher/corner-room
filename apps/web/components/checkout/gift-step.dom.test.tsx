// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { GiftStep, NO_GIFT, readGift, type GiftDraft } from "./gift-step";

function Harness({ own = "me@example.com" }: { own?: string }) {
  const [draft, setDraft] = useState<GiftDraft>(NO_GIFT);
  return <GiftStep draft={draft} onChange={setDraft} ownEmail={own} each={{ amount_minor: 3000, currency_code: "BDT" }} />;
}

afterEach(cleanup);

describe("GiftStep (owner, 2026-11-20, D-GIFT-FAN-01)", () => {
  it("opens the gift form, refuses the giver's own email and counts the people", () => {
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
  });

  it("reads the people and the note the server will check", () => {
    expect(readGift({ on: true, peopleText: "a@example.com, b@example.com", note: "  Hi " }, null)).toEqual({
      people: [
        { email: "a@example.com", name: null },
        { email: "b@example.com", name: null },
      ],
      note: "Hi",
      problem: null,
    });
    expect(readGift({ on: true, peopleText: "a@example.com", note: "x".repeat(301) }, null).problem).toMatch(/300/);
  });
});
