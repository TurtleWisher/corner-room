import { describe, expect, it } from "vitest";

import {
  formatMinor,
  journalStatusLabel,
  payoutNeedsSecondApprover,
} from "./finance-view";

describe("finance view is display-only", () => {
  it("formats API integers without inventing a rate", () => {
    expect(formatMinor(2500, "BDT")).toBe("2500 BDT");
  });

  it("labels posted journals from server status", () => {
    expect(journalStatusLabel("POSTED")).toBe("Posted");
    expect(journalStatusLabel("REVERSED")).toBe("Reversed");
  });

  it("treats a missing payout threshold as fail-closed in the UI hint", () => {
    expect(payoutNeedsSecondApprover(1, null)).toBe(true);
    expect(payoutNeedsSecondApprover(99, 100)).toBe(false);
    expect(payoutNeedsSecondApprover(100, 100)).toBe(true);
  });
});
