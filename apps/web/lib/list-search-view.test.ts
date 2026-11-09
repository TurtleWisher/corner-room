import { describe, expect, it } from "vitest";

import { fold, matches, searchList, shownCount } from "./list-search-view";

describe("search", () => {
  it("ignores case, accents and spaces", () => {
    expect(fold("  Café   RUMI ")).toBe("cafe rumi");
    expect(matches("cafe", ["Café Rumi"])).toBe(true);
    expect(matches("RUMI   café", ["Café Rumi"])).toBe(true);
  });

  it("needs every word somewhere", () => {
    expect(matches("samiul dhaka", ["Samiul Islam", null, "Road 4, Dhaka"])).toBe(true);
    expect(matches("samiul sylhet", ["Samiul Islam", "Road 4, Dhaka"])).toBe(false);
  });

  it("finds a phone by its digits", () => {
    expect(matches("01712", ["+880 1712-345678"])).toBe(true);
    expect(matches("+880 1712", ["+880 1712-345678"])).toBe(true);
    expect(matches("99", ["+880 1712-345678"])).toBe(false);
  });

  it("keeps Bangla as typed", () => {
    expect(matches("রুমি", ["রুমি আহমেদ"])).toBe(true);
  });

  it("filters lists and counts", () => {
    const people = [{ name: "Rumi" }, { name: "Kaal Bela" }];
    expect(searchList(people, "", (p) => [p.name])).toHaveLength(2);
    expect(searchList(people, "bela", (p) => [p.name])).toEqual([{ name: "Kaal Bela" }]);
    expect(shownCount(1, 2)).toBe("1 of 2");
    expect(shownCount(2, 2)).toBe("2");
  });
});
