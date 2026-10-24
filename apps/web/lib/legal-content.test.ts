import { describe, expect, it } from "vitest";

import { LEGAL_DOCUMENTS } from "./legal-content";
import { LEGAL_LINKS, supportMailto } from "./site-contact";

const allText = (doc: (typeof LEGAL_DOCUMENTS)[keyof typeof LEGAL_DOCUMENTS]) =>
  [doc.title, doc.lede, ...doc.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])].join("\n");

describe("legal pages", () => {
  it("has a page for every footer link, each with content", () => {
    for (const link of LEGAL_LINKS) {
      const doc = LEGAL_DOCUMENTS[link.href.slice(1) as keyof typeof LEGAL_DOCUMENTS];
      expect(doc, link.href).toBeTruthy();
      expect(doc.sections.length).toBeGreaterThan(2);
      for (const section of doc.sections) expect((section.paragraphs?.length ?? 0) + (section.bullets?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it("follows the copy rules: no em dashes, no subscriptions or catalog pass, no invented numbers", () => {
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      const text = allText(doc);
      expect(text).not.toContain("—");
      // D-COMMERCE-01: music is sold per song and per release only.
      expect(text).not.toMatch(/subscri|catalog pass|whole catalog/i);
      // No refund percentages, fees or day counts: those are owner decisions.
      expect(text).not.toMatch(/\d+\s*(%|percent|days?\b|hours?\b)/i);
    }
  });

  it("builds the support mail link", () => {
    expect(supportMailto()).toBe("mailto:support@cornerroom.live");
    expect(supportMailto("Refunds")).toBe("mailto:support@cornerroom.live?subject=Refunds");
  });
});
