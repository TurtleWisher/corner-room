import { describe, expect, it } from "vitest";

import { paidWords, TEST_BUY_WORDS } from "./test-buy-view";

describe("staff test buys (owner, 2026-11-21, D-TEST-BUY-01)", () => {
  it("never calls a test money", () => {
    expect(paidWords({ is_test: true, paid_with_credit_minor: 0 })).toBe("test");
    expect(paidWords({ is_test: false, paid_with_credit_minor: 3000 })).toBe("credit");
    expect(paidWords({})).toBe("money");
  });

  it("says plainly what a test does and doesn't do", () => {
    expect(TEST_BUY_WORDS.body).toMatch(/no money moves/);
    expect(TEST_BUY_WORDS.body).toMatch(/never reaches sales, royalties, the artist/);
    expect(TEST_BUY_WORDS.button).toBe("Complete as a test");
  });
});
