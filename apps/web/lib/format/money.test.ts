import { describe, expect, it } from "vitest";

import { currencyExponent, formatMoney, formatMoneyParts, minorToDecimalString } from "./money";

describe("currencyExponent", () => {
  it("uses ISO 4217 minor units", () => {
    expect(currencyExponent("BDT")).toBe(2);
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });
  it("rejects malformed codes", () => {
    expect(currencyExponent("bdt")).toBeNull();
    expect(currencyExponent("TAKA")).toBeNull();
    expect(currencyExponent("")).toBeNull();
  });
});

describe("minorToDecimalString", () => {
  it("shifts the decimal point exactly", () => {
    expect(minorToDecimalString(BigInt("150050"), 2)).toBe("1500.50");
    expect(minorToDecimalString(BigInt("5"), 2)).toBe("0.05");
    expect(minorToDecimalString(BigInt("-120000"), 2)).toBe("-1200.00");
    expect(minorToDecimalString(BigInt("1500"), 0)).toBe("1500");
    expect(minorToDecimalString(BigInt("9007199254740993"), 2)).toBe("90071992547409.93");
  });
});

describe("formatMoney", () => {
  it("fixes the audit bug: 150000 BDT renders as ৳1,500", () => {
    expect(formatMoney({ amount_minor: 150000, currency_code: "BDT" })).toBe("৳1,500");
  });
  it("uses lakh grouping", () => {
    expect(formatMoney({ amount_minor: 41250000, currency_code: "BDT" })).toBe("৳4,12,500");
  });
  it("shows the full exponent in tables and when the minor part is not zero", () => {
    expect(formatMoney({ amount_minor: 150000, currency_code: "BDT" }, { minorDigits: "always" })).toBe("৳1,500.00");
    expect(formatMoney({ amount_minor: 150050, currency_code: "BDT" })).toBe("৳1,500.50");
  });
  it("formats negatives without changing the amount", () => {
    expect(formatMoney({ amount_minor: -120000, currency_code: "BDT" })).toBe("-৳1,200");
  });
  it("never assumes a currency", () => {
    expect(formatMoney({ amount_minor: 1999, currency_code: "USD" })).toBe("$19.99");
    expect(formatMoney({ amount_minor: 1500, currency_code: "JPY" })).toBe("¥1,500");
  });
  it("accepts integer strings and bigint", () => {
    expect(formatMoney({ amount_minor: "150000", currency_code: "BDT" })).toBe("৳1,500");
    expect(formatMoney({ amount_minor: BigInt("150000"), currency_code: "bdt" })).toBe("৳1,500");
  });
  it("returns null for unknown or malformed values instead of 0", () => {
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney({ amount_minor: null, currency_code: "BDT" })).toBeNull();
    expect(formatMoney({ amount_minor: 1500, currency_code: null })).toBeNull();
    expect(formatMoney({ amount_minor: 15.5, currency_code: "BDT" })).toBeNull();
    expect(formatMoney({ amount_minor: "15.50", currency_code: "BDT" })).toBeNull();
    expect(formatMoney({ amount_minor: 1500, currency_code: "XXXX" })).toBeNull();
  });
  it("renders Bangla digits for the bn locale", () => {
    expect(formatMoney({ amount_minor: 150000, currency_code: "BDT" }, { locale: "bn" })).toBe("১,৫০০৳");
  });
});

describe("formatMoneyParts", () => {
  it("exposes the symbol part and an accessible code form", () => {
    const out = formatMoneyParts({ amount_minor: 150000, currency_code: "BDT" });
    expect(out?.parts.find((p) => p.type === "currency")?.value).toBe("৳");
    expect(out?.accessibleText).toBe("BDT 1,500");
    expect(out?.isNegative).toBe(false);
  });
});
