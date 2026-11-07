import { describe, expect, it } from "vitest";

import type { StatusMail } from "@/features/gifts/api";
import { previewValues, sendingLine, sendingWords, sentCountLine, startingWords } from "@/lib/gift-status-mail-view";

const item = (over: Partial<StatusMail> = {}): StatusMail => ({
  status: "DISPATCHED",
  default_subject: "A gift is on its way",
  default_body: "Hi {first_name}, your {gift} is on its way.",
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
});

describe("gift status emails (D-CAMPAIGN-05)", () => {
  it("says whose words send", () => {
    expect(sendingLine(item())).toMatch(/Corner Room's wording sends/);
    expect(sendingLine(item({ live: true, state: "APPROVED" }))).toBe("Your words send.");
    expect(sendingLine(item({ live: true, state: "IN_REVIEW" }))).toMatch(/approved words send until/);
  });

  it("shows the words that go out and the words to edit", () => {
    expect(sendingWords(item()).subject).toBe("A gift is on its way");
    const live = item({ live: true, live_subject: "Off it goes", live_body: "Hi!", subject: "Draft", body: "New", state: "DRAFT" });
    expect(sendingWords(live)).toEqual({ subject: "Off it goes", body: "Hi!" });
    expect(startingWords(live)).toEqual({ subject: "Draft", body: "New" });
    expect(startingWords(item())).toEqual({ subject: "A gift is on its way", body: "Hi {first_name}, your {gift} is on its way." });
  });

  it("previews as a buyer with no name on file and counts sends", () => {
    expect(previewValues("MIZULS", "", "A poster")).toEqual({ first_name: "friend", buyer_name: "friend", artist: "MIZULS", music: "your music", gift: "A poster" });
    expect(sentCountLine(0)).toBe("Not sent yet");
    expect(sentCountLine(1)).toBe("Sent 1 time");
    expect(sentCountLine(12)).toBe("Sent 12 times");
  });
});
