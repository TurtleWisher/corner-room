import { describe, expect, it } from "vitest";

import { formatCount } from "./count";

describe("formatCount", () => {
  it("groups whole numbers the Bangladeshi way and never abbreviates", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(123456)).toBe("1,23,456");
  });
  it("says Not available instead of inventing a zero", () => {
    expect(formatCount(null)).toBe("Not available");
    expect(formatCount(undefined)).toBe("Not available");
  });
});
