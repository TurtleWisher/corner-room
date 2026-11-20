import { describe, expect, it } from "vitest";

import {
  GIVER_STATE,
  giftHeadline,
  giftPromise,
  giftStatusLine,
  noteProblem,
  giftPaidLine,
  emailBody,
  fileProblem,
  giftHref,
  giftOffer,
  linksProblem,
  noteText,
  previewPeople,
  subjectProblem,
  withPictures,
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
    expect(noteProblem("x".repeat(2001))).toMatch(/2,000/);
    expect(noteProblem("see [this](http://x.example)")).toMatch(/https/);
    expect(noteProblem("Happy Eid")).toBeNull();
  });

  it("never tells the giver why, and promises only what the server does", () => {
    expect(Object.values(GIVER_STATE).join(" ")).not.toMatch(/own|already|bought/i);
    expect(giftPromise(true)[0]).toMatch(/checked your email/);
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
    expect(recipientLine({ status: "GIVEN", title: "T", act_name: "A", preorder: true })).toMatch(/unlocks/);
    expect(signInHref("abc", "register")).toBe("/register?next=%2Fgift%2Fabc");
  });

  it("finds the gift price whether or not the giver owns the music", () => {
    const offer = (id: string, product_type: string, subject_id: string, audience = "EVERYONE") =>
      ({ id, product_type, subject_id, audience, status: "ACTIVE", amount_minor: 3000, currency_code: "BDT", name: "x" }) as never;
    const offers = [offer("o1", "TRACK", "t1"), offer("o2", "RELEASE", "r1"), offer("o3", "RELEASE", "r2", "PRESALE"), offer("o4", "RELEASE", "r1", "OWNS_PART_OF_RELEASE")];
    expect(giftOffer(offers, "TRACK", "t1")?.id).toBe("o1");
    // A song sold only with its release is given as that release.
    expect(giftOffer(offers, "TRACK", "t2", ["r1"])?.id).toBe("o2");
    expect(giftOffer(offers, "RELEASE", "r1")?.id).toBe("o2");
    // Owner, 2026-11-20: pre-orders can be gifts the same way.
    expect(giftOffer(offers, "RELEASE", "r2")?.id).toBe("o3");
    expect(giftOffer(offers, "RELEASE", "r3")).toBeNull();
    expect(giftHref("o2")).toBe("/checkout?offer=o2&gift=1");
  });

  it("checks the giver's email as the server does, and draws previews with this page's pictures (D-GIFT-FAN-02)", () => {
    expect(subjectProblem("For you")).toBeNull();
    expect(subjectProblem("x".repeat(151))).toMatch(/150/);
    expect(subjectProblem("see [it](https://x.example)")).toMatch(/link/);
    expect(linksProblem("[ok](https://x.example) and [bad](ftp://x)")).toMatch(/https/);
    expect(linksProblem("[ok](https://x.example)")).toBeNull();
    expect(fileProblem({ type: "image/png", size: 10 }, 0)).toBeNull();
    expect(fileProblem({ type: "audio/mpeg", size: 10 }, 0)).toMatch(/picture/);
    expect(fileProblem({ type: "image/png", size: 10 }, 5)).toMatch(/at most 5/);
    expect(fileProblem({ type: "application/pdf", size: 30 * 1024 * 1024 }, 0)).toMatch(/too large/);
    const id = "0b5e8a52-6c1f-4f0e-9a8d-3c2b1a0f9e8d";
    expect(withPictures(`<img src="cid:file-${id}">`, { [id]: "blob:x" })).toBe('<img src="blob:x">');
    expect(emailBody("<html><head><title>t</title></head><body style=\"x\"><p>Hi</p></body></html>")).toBe("<p>Hi</p>");
    expect(previewPeople([])).toEqual([{ label: "Someone without a name", name: null }]);
    expect(previewPeople([{ email: "a@example.com", name: "Rumi" }, { email: "b@example.com" }]).map((p) => p.label)).toEqual(["Rumi", "b@example.com"]);
    expect(noteText("Dear {first_name}, see [our song](https://x.example)!")).toBe("Dear, see our song!");
  });
});
