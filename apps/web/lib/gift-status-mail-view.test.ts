import { describe, expect, it } from "vitest";

import type { StatusMail } from "@/features/gifts/api";
import {
  anyOnItsWay,
  buttonProblem,
  changed,
  inUseLabel,
  lastEmail,
  namesLine,
  notInUseLine,
  peopleIn,
  previewValues,
  sendingLine,
  sendingVersion,
  sentCountLine,
  sentNowLine,
  startingVersion,
  subjectForAll,
  submitDoneLine,
  submitLabel,
  firstNameInstead,
  namesWrittenOut,
  STATUS_MAIL_WHEN,
  updateButtonLabel,
  updateSentLine,
  updatesWaitingLine,
  workflowSteps,
} from "@/lib/gift-status-mail-view";

const item = (over: Partial<StatusMail> = {}): StatusMail => ({
  status: "DISPATCHED",
  default_subject: "A gift is on its way",
  default_body: "Hi {first_name}, your {gift} is on its way.",
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
});

describe("gift status emails (D-CAMPAIGN-05, D-CAMPAIGN-06)", () => {
  it("says which version sends", () => {
    expect(sendingLine(item())).toMatch(/Corner Room's wording sends/);
    expect(sendingLine(item({ live: true, state: "APPROVED" }))).toBe("Your email sends.");
    expect(sendingLine(item({ live: true, state: "IN_REVIEW" }))).toMatch(/approved email sends until/);
  });

  it("knows the version that goes out and the one being edited, button and files included", () => {
    expect(sendingVersion(item()).subject).toBe("A gift is on its way");
    const live = item({
      live: true,
      live_subject: "Off it goes",
      live_body: "Hi!",
      live_button_label: "Track",
      live_button_url: "https://t.example",
      live_file_ids: ["f1"],
      subject: "Draft",
      body: "New",
      state: "DRAFT",
    });
    expect(sendingVersion(live)).toEqual({ subject: "Off it goes", body: "Hi!", button_label: "Track", button_url: "https://t.example", file_ids: ["f1"] });
    expect(startingVersion(live)).toMatchObject({ subject: "Draft", body: "New" });
    expect(startingVersion(item()).body).toBe("Hi {first_name}, your {gift} is on its way.");
    expect(changed(sendingVersion(live), { ...sendingVersion(live), file_ids: [] })).toBe(true);
    expect(changed(sendingVersion(live), sendingVersion(live))).toBe(false);
  });

  it("needs both words and an https link for a button, or neither", () => {
    expect(buttonProblem(null, "")).toBeNull();
    expect(buttonProblem("Track", "https://t.example")).toBeNull();
    expect(buttonProblem("Track", "")).toMatch(/web address/);
    expect(buttonProblem("", "https://t.example")).toMatch(/words/);
    expect(buttonProblem("Track", "t.example")).toMatch(/https/);
  });

  it("previews as the real buyer by name, and picks the buyers in a status", () => {
    expect(previewValues({ name: "Samiul Islam" }, "MIZULS", "Chaya Pore")).toEqual({
      first_name: "Samiul",
      buyer_name: "Samiul Islam",
      artist: "MIZULS",
      music: "Chaya Pore",
      // What the gift is stays a surprise (D-CAMPAIGN-09).
      gift: "collectible",
    });
    expect(previewValues(null, "MIZULS", "").first_name).toBe("there");
    const people = [
      { id: "a", name: "A", status: "DISPATCHED" as const, reachable: true },
      { id: "b", name: "B", status: "PREPARED" as const, reachable: true },
      { id: "c", name: "C", status: "DISPATCHED" as const, reachable: false },
    ];
    expect(peopleIn(people, "DISPATCHED").map((p) => p.id)).toEqual(["a"]);
    expect(sentCountLine(0)).toBe("Not sent yet");
    expect(sentCountLine(12)).toBe("Sent 12 times");
    // Owner, 2026-11-21 (D-CAMPAIGN-09): never what the gift is.
    expect(subjectForAll("Your gift from {artist}, {first_name}: {gift}", "Rumi", "")).toBe("Your gift from Rumi, (their first name): collectible");
    expect(subjectForAll("Your gift ({gift}) left", "Rumi", "")).toBe("Your gift left");
  });

  it("tells the workflow step by step, from the API's state", () => {
    const tones = (it: StatusMail, atOnce = false) => workflowSteps(it, atOnce).map((s) => s.tone);
    expect(tones(item())).toEqual(["now", "skip", "skip"]);
    expect(workflowSteps(item(), false)[0].line).toMatch(/Corner Room's wording/);
    expect(workflowSteps(item({ state: "DRAFT" }), false)[1].line).toMatch(/Send for approval/);
    expect(workflowSteps(item({ state: "DRAFT" }), true)[1].line).toMatch(/Use this email puts it in use at once/);
    expect(tones(item({ state: "IN_REVIEW" }))).toEqual(["done", "waiting", "skip"]);
    expect(tones(item({ state: "APPROVED", live: true, sent_count: 3 }))).toEqual(["done", "done", "done"]);
    expect(workflowSteps(item({ sent_count: 3 }), false)[2].line).toMatch(/press Send the Dispatched update.*Sent 3 times so far/);
    expect(workflowSteps(item({ state: "RETURNED", review_note: "Name the courier" }), false)[1]).toMatchObject({ tone: "problem", line: "Sent back: Name the courier" });
  });

  it("says what is in use, what isn't yet, and what the main button really does", () => {
    expect(inUseLabel(item())).toBe("Corner Room's wording");
    expect(inUseLabel(item({ live: true }))).toBe("Your approved email");
    expect(notInUseLine(item({ state: "APPROVED" }))).toBeNull();
    expect(notInUseLine(item({ state: "IN_REVIEW" }))).toMatch(/waiting for Corner Room/);
    expect(submitLabel(true)).toBe("Use this email");
    expect(submitLabel(false)).toBe("Send for approval");
    expect(submitDoneLine(item({ state: "APPROVED" }))).toMatch(/^Approved and in use.*Nobody was emailed/);
    expect(submitDoneLine(item({ state: "IN_REVIEW" }))).toMatch(/^Sent to Corner Room for approval. Nobody was emailed/);
  });

  it("reads each buyer's delivery and the result of sending now", () => {
    const h = (rid: string, state: "PENDING" | "SENT", status: "DISPATCHED" | "MISSING" = "DISPATCHED") => ({
      recipient_id: rid, gift_status: status, state, queued_at: "2026-11-08T08:00:00Z", sent_at: null,
    });
    const history = [h("a", "PENDING"), h("a", "SENT"), h("b", "SENT", "MISSING")];
    expect(lastEmail(history, "a", "DISPATCHED")?.state).toBe("PENDING");
    expect(lastEmail(history, "b", "DISPATCHED")).toBeNull();
    expect(anyOnItsWay(history)).toBe(true);
    expect(anyOnItsWay([h("a", "SENT")])).toBe(false);
    expect(namesLine(["Samiul"])).toBe("Samiul");
    expect(namesLine(["Samiul", "Rumi"])).toBe("Samiul and Rumi");
    expect(namesLine(["A", "B", "C", "D", "E"])).toBe("A, B and 3 others");
    expect(sentNowLine(2, 0, ["Samiul", "Rumi"])).toMatch(/^Emailed 2 buyers \(Samiul and Rumi\)/);
    expect(sentNowLine(1, 1, [])).toMatch(/Emailed 1 buyer\. .*1 skipped/);
    expect(sentNowLine(0, 2, [])).toMatch(/^Nobody was emailed/);
  });
});

describe("Send update (owner, 2026-11-20, D-CAMPAIGN-08)", () => {
  it("says the email waits for the button", () => {
    expect(Object.values(STATUS_MAIL_WHEN).every((w) => /^Sends when you press Send the \w+ update, never/.test(w))).toBe(true);
    expect(updateButtonLabel("DISPATCHED")).toBe("Send the Dispatched update");
    expect(updateButtonLabel("MISSING", 2)).toBe("Send the Missing update to 2");
    expect(updatesWaitingLine("RETURNED", 1)).toBe("1 buyer is marked returned and hasn't been told yet.");
    expect(updatesWaitingLine("DISPATCHED", 4)).toBe("4 buyers are marked dispatched and haven't been told yet.");
    expect(updateSentLine(3, 3)).toMatch(/^Told 3 buyers\./);
    expect(updateSentLine(3, 2)).toBe("Told 3 buyers: 2 by email, 1 only in their Corner Room account (no email address).");
  });
});

describe("a buyer's name typed out (owner, 2026-11-20)", () => {
  const names = ["Ishmamul Haque", "Samiul Islam", null];
  it("finds a name in the subject or greeting line, as the server does", () => {
    expect(namesWrittenOut("Your gift left", "Dear Ishmamul,\n\nYour poster left.", names)).toEqual(["Ishmamul"]);
    expect(namesWrittenOut("On its way, Samiul", "Hi {first_name}", names)).toEqual(["Samiul"]);
    expect(namesWrittenOut("On its way, samiul", "Hi {first_name}", names)).toEqual([]);
    expect(namesWrittenOut("Your {gift} left", "Hi {first_name},\n\nThanks, Samiul here.", names)).toEqual([]);
    expect(namesWrittenOut("x", "Hi {first_name}, I hope you love it", ["Hope Rahman"])).toEqual([]);
    expect(namesWrittenOut("From Mizuls", "Hi {first_name}", ["Mizuls Fan"], ["MIZULS"])).toEqual([]);
    expect(namesWrittenOut("x", "See [Ishmamul's map](https://ishmamul.example/x)", names)).toEqual([]);
    expect(namesWrittenOut("x", "প্রিয় সামিউল,", ["সামিউল ইসলাম"])).toEqual(["সামিউল"]);
  });
  it("puts the First name fill-in in its place, leaving fill-ins, links and later lines alone", () => {
    expect(
      firstNameInstead("Ishmamul, it's on its way", "Dear Ishmamul, [Ishmamul's map](https://ishmamul.example)\n\nIshmamul said hi.", ["Ishmamul"]),
    ).toEqual({
      subject: "{first_name}, it's on its way",
      body: "Dear {first_name}, [Ishmamul's map](https://ishmamul.example)\n\nIshmamul said hi.",
    });
    expect(firstNameInstead("a", "b", [])).toEqual({ subject: "a", body: "b" });
  });
});

