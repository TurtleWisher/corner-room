import { describe, expect, it } from "vitest";

import { unfilledMarks } from "@/lib/artist-mail-view";
import { giftTemplates } from "@/lib/gift-status-mail-templates";

describe("gift status email templates (D-CAMPAIGN-06)", () => {
  it("offers templates for every status that greet the buyer by name", () => {
    for (const status of ["DISPATCHED", "RETURNED", "MISSING"] as const) {
      const list = giftTemplates(status, "I", "https://www.cornerroom.live");
      expect(list.length).toBeGreaterThanOrEqual(2);
      for (const t of list) {
        expect(t.body.startsWith("Hi {first_name}")).toBe(true);
        expect(t.body).toContain("{gift}");
      }
    }
  });

  it("writes in the act's own voice", () => {
    expect(giftTemplates("MISSING", "I", "https://x")[0].body).toContain("I'm finding out");
    expect(giftTemplates("MISSING", "we", "https://x")[0].body).toContain("we're finding out");
    expect(giftTemplates("DISPATCHED", "we", "https://x")[0].body).toContain("We hope you love it");
  });

  it("marks what only the act knows and links the address page it does know", () => {
    const tracking = giftTemplates("DISPATCHED", "I", "https://x").find((t) => t.id === "tracking")!;
    expect(unfilledMarks(tracking.body)).toEqual(["[add the courier's name]"]);
    expect(tracking.button).toEqual({ label: "Track your parcel", url: "" });
    expect(giftTemplates("RETURNED", "I", "https://www.cornerroom.live/")[0].button?.url).toBe("https://www.cornerroom.live/account");
  });
});

describe("other gift news templates (D-CAMPAIGN-07)", () => {
  it("greets by name, mentions the gift and leaves the news to the act", async () => {
    const { otherTemplates } = await import("@/lib/gift-status-mail-templates");
    const list = otherTemplates("we", "https://x/");
    expect(list.every((t) => t.body.startsWith("Hi {first_name}") && t.body.includes("{gift}"))).toBe(true);
    expect(unfilledMarks(list[0].body)).toEqual(["[add the news]"]);
    expect(list[1].body).toContain("We're getting");
    expect(list[1].button?.url).toBe("https://x/account");
  });
});
