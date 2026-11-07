import { describe, expect, it } from "vitest";

import { fansSeeLine, switchStateText } from "@/lib/cover-reveal-view";

describe("pre-sale cover switch (D-COVER-03)", () => {
  it("says what fans see for each of the four cases", () => {
    expect(fansSeeLine(false, true)).toMatch(/cover a little blurred/);
    expect(fansSeeLine(true, true)).toBe("Fans see your cover clearly.");
    expect(fansSeeLine(false, false)).toMatch(/title on a glowing screen, a little blurred/);
    expect(fansSeeLine(true, false)).toMatch(/title on a glowing screen, clearly/);
  });

  it("names the switch's state in words", () => {
    expect(switchStateText(true)).toBe("On");
    expect(switchStateText(false)).toBe("Off");
  });
});
