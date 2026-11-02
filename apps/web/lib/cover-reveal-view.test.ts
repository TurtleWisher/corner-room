import { describe, expect, it } from "vitest";

import { REVEAL_CHOICES, leadFromValue, leadLabel, revealOptions, revealStatus, revealValue } from "@/lib/cover-reveal-view";

describe("cover reveal view", () => {
  it("names a lead time in plain words", () => {
    expect(leadLabel(null)).toBe("With the release");
    expect(leadLabel(120)).toBe("2 hours before");
    expect(leadLabel(60)).toBe("1 hour before");
    expect(leadLabel(3 * 24 * 60)).toBe("3 days before");
    expect(leadLabel(24 * 60 + 6 * 60)).toBe("1 day and 6 hours before");
    expect(leadLabel(90)).toBe("1 hour and 30 minutes before");
  });

  it("offers the ready-made choices and keeps an unusual saved one", () => {
    expect(REVEAL_CHOICES[0]).toEqual({ value: "", label: "With the release" });
    expect(revealOptions(120)).toBe(REVEAL_CHOICES);
    const withOdd = revealOptions(90);
    expect(withOdd.map((o) => o.value)).toContain("90");
    expect(withOdd[0].value).toBe("");
    expect(withOdd[1]).toEqual({ value: "90", label: "1 hour and 30 minutes before" });
  });

  it("turns select values into leads and back", () => {
    expect(revealValue(null)).toBe("");
    expect(revealValue(2880)).toBe("2880");
    expect(leadFromValue("")).toBeNull();
    expect(leadFromValue("2880")).toBe(2880);
    expect(leadFromValue("abc")).toBeNull();
  });

  it("reads where the cover stands", () => {
    expect(revealStatus(null)).toBe("with_release");
    expect(revealStatus({ lead_minutes: 120, reveal_at: null })).toBe("waiting_for_date");
    expect(revealStatus({ lead_minutes: 120, reveal_at: "2026-11-05T10:00:00Z" })).toBe("timed");
    expect(revealStatus({ lead_minutes: 120, reveal_at: "2026-11-05T10:00:00Z", revealed: true })).toBe("revealed");
    expect(revealStatus({ revealed_at: "2026-11-02T10:00:00Z", revealed: true })).toBe("revealed");
  });
});
