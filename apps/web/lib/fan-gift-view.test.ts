import { describe, expect, it } from "vitest";

import {
  GIVER_STATE,
  giftHeadline,
  giftPromise,
  giftStatusLine,
  noteProblem,
  giftPaidLine,
  parsePeople,
  peopleProblem,
  recipientLine,
  signInHref,
} from "./fan-gift-view";

describe("fan gifts (owner, 2026-11-20, D-GIFT-FAN-01)", () => {
  it("reads people from lines, commas and name <email>", () => {
    expect(parsePeople("Rumi Das <Rumi@Example.com>\nnila@example.com, tushar@example.com")).toEqual([
      { email: "rumi@example.com", name: "Rumi Das" },
      { email: "nila@example.com", name: null },
      { email: "tushar@example.com", name: null },
    ]);
    expect(parsePeople("  \n , ")).toEqual([]);
  });

  it("names what stops a gift, as the server does", () => {
    expect(peopleProblem([], "me@example.com")).toMatch(/at least one/);
    expect(peopleProblem([{ email: "nope" }], "me@example.com")).toMatch(/isn't a complete/);
    expect(peopleProblem([{ email: "me@example.com" }], "ME@example.com")).toMatch(/your own email/);
    expect(peopleProblem([{ email: "a@example.com" }, { email: "a@example.com" }], null)).toMatch(/twice/);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ email: `p${i}@example.com` }));
    expect(peopleProblem(eleven, null)).toMatch(/at most 10/);
    expect(peopleProblem([{ email: "a@example.com" }], "me@example.com")).toBeNull();
    expect(noteProblem("x".repeat(301))).toMatch(/300/);
    expect(noteProblem("Happy Eid")).toBeNull();
  });

  it("never tells the giver why, and promises only what the server does", () => {
    expect(Object.values(GIVER_STATE).join(" ")).not.toMatch(/own|already|bought/i);
    expect(giftPromise(true)[0]).toMatch(/checked your note/);
    expect(giftPromise(false).join(" ")).toMatch(/7 days/);
    expect(giftStatusLine({ status: "WAITING_NOTE", note_state: "WAITING" })).toMatch(/checking your note/);
    expect(giftStatusLine({ status: "DELIVERED", note_state: "REMOVED" })).toMatch(/without your note/);
    expect(giftPaidLine(3)).toBe("We email 3 people now, or as soon as Corner Room has checked your note.");
    expect(giftPaidLine(1)).toMatch(/^We email 1 person/);
  });

  it("tells the person who got it where they stand", () => {
    const page = { giver_name: "Samiul", passed_on_by: null, title: "Chhaya Pore", act_name: "MIZULS" };
    expect(giftHeadline(page)).toBe("Samiul sent you Chhaya Pore by MIZULS");
    expect(giftHeadline({ ...page, giver_name: null, passed_on_by: "Rumi" })).toBe("Rumi sent you Chhaya Pore by MIZULS");
    expect(recipientLine({ status: "CHOOSING", title: "Chhaya Pore", act_name: "MIZULS" })).toMatch(/already own Chhaya Pore/);
    expect(recipientLine({ status: "KEPT_CREDIT", title: "T", act_name: "MIZULS" })).toMatch(/MIZULS's music/);
    expect(signInHref("abc", "register")).toBe("/register?next=%2Fgift%2Fabc");
  });
});
