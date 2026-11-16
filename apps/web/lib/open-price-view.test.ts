import { describe, expect, it } from "vitest";

import { amountAsTyped, amountProblemWords, lowestFor, priceLead, rangeProblem, readChosenAmount } from "./open-price-view";

const offer = { amount_minor: 10_000, open_price: true, open_price_max_minor: null };

describe("amountAsTyped", () => {
  it("writes whole taka without a decimal part", () => {
    expect(amountAsTyped(10_000)).toBe("100");
  });
  it("keeps paisa as two digits", () => {
    expect(amountAsTyped(12_050)).toBe("120.50");
    expect(amountAsTyped(12_005)).toBe("120.05");
  });
});

describe("readChosenAmount", () => {
  it("accepts the lowest amount and anything above it", () => {
    expect(readChosenAmount("100", offer)).toEqual({ minor: 10_000, problem: null });
    expect(readChosenAmount("10,000", offer)).toEqual({ minor: 1_000_000, problem: null });
    expect(readChosenAmount("৳ 150.50", offer)).toEqual({ minor: 15_050, problem: null });
  });
  it("refuses less than the lowest amount", () => {
    expect(readChosenAmount("99.99", offer)).toEqual({ minor: null, problem: "TOO_LOW" });
  });
  it("refuses more than the limit only when a limit is set", () => {
    expect(readChosenAmount("5001", { ...offer, open_price_max_minor: 500_000 })).toEqual({ minor: null, problem: "TOO_HIGH" });
    expect(readChosenAmount("5000", { ...offer, open_price_max_minor: 500_000 })).toEqual({ minor: 500_000, problem: null });
    expect(readChosenAmount("999999", { ...offer, open_price_max_minor: 0 }).problem).toBeNull();
  });
  it("names an empty or unreadable amount", () => {
    expect(readChosenAmount("  ", offer).problem).toBe("EMPTY");
    expect(readChosenAmount("lots", offer).problem).toBe("NOT_A_NUMBER");
    expect(readChosenAmount("1.234", offer).problem).toBe("NOT_A_NUMBER");
    expect(readChosenAmount("-5", offer).problem).toBe("NOT_A_NUMBER");
  });
});

describe("words", () => {
  it("says the lowest amount", () => {
    expect(amountProblemWords("TOO_LOW", "৳100", null)).toBe("The lowest amount for this music is ৳100.");
  });
  it("says the limit when it is known", () => {
    expect(amountProblemWords("TOO_HIGH", "৳100", "৳5,000")).toBe("The most you can pay for this music is ৳5,000.");
  });
  it("leads only an open price with From", () => {
    expect(priceLead({ open_price: true })).toBe("From");
    expect(priceLead({ open_price: false })).toBeNull();
    expect(priceLead({})).toBeNull();
  });
});

describe("the owner's range (৳10 to ৳100,000)", () => {
  const range = { min_minor: 1_000, max_minor: 10_000_000 };
  it("takes an artist's lowest inside it and names which end it missed", () => {
    expect(rangeProblem(1_000, range)).toBeNull();
    expect(rangeProblem(10_000_000, range)).toBeNull();
    expect(rangeProblem(999, range)).toBe("TOO_LOW");
    expect(rangeProblem(10_000_001, range)).toBe("TOO_HIGH");
    expect(rangeProblem(5, null)).toBeNull();
  });
  it("holds a buyer to the server's floor when it is above the artist's amount", () => {
    expect(lowestFor({ amount_minor: 500, open_price: true, open_price_min_minor: 1_000 })).toBe(1_000);
    expect(lowestFor({ amount_minor: 10_000, open_price: true, open_price_min_minor: 10_000 })).toBe(10_000);
    expect(readChosenAmount("9", { amount_minor: 500, open_price: true, open_price_min_minor: 1_000 }).problem).toBe("TOO_LOW");
    expect(readChosenAmount("100000.01", { amount_minor: 1_000, open_price: true, open_price_max_minor: 10_000_000 }).problem).toBe("TOO_HIGH");
  });
});
