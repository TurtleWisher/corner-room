import { describe, expect, it } from "vitest";

import type { StatusMail } from "@/features/gifts/api";
import { buttonProblem, changed, peopleIn, previewValues, sendingLine, sendingVersion, sentCountLine, startingVersion, subjectForAll } from "@/lib/gift-status-mail-view";

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
    expect(previewValues({ name: "Samiul Islam" }, "MIZULS", "Chaya Pore", "A poster")).toEqual({
      first_name: "Samiul",
      buyer_name: "Samiul Islam",
      artist: "MIZULS",
      music: "Chaya Pore",
      gift: "A poster",
    });
    expect(previewValues(null, "MIZULS", "", "A poster").first_name).toBe("there");
    const people = [
      { id: "a", name: "A", status: "DISPATCHED" as const, reachable: true },
      { id: "b", name: "B", status: "PREPARED" as const, reachable: true },
      { id: "c", name: "C", status: "DISPATCHED" as const, reachable: false },
    ];
    expect(peopleIn(people, "DISPATCHED").map((p) => p.id)).toEqual(["a"]);
    expect(sentCountLine(0)).toBe("Not sent yet");
    expect(sentCountLine(12)).toBe("Sent 12 times");
    expect(subjectForAll("Your gift from {artist}, {first_name}: {gift}", "Rumi", "", "A card")).toBe("Your gift from Rumi, (their first name): A card");
  });
});
