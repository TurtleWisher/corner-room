import { describe, expect, it } from "vitest";

import { dropIndex, moveTo, onlyCreditOrderChanged } from "./credit-order-view";

const writer = { id: "c1", role_key: "songwriter", display_name: "Mitul", artist_id: null, instrument: null };
const art = { id: "c2", role_key: "custom", display_name: "Aryan", instrument: "Artwork" };
const band = { id: "c3", role_key: "performer", artist_id: "a1", artist_name: "Kaal Bela" };

describe("onlyCreditOrderChanged", () => {
  it("is true for the same credits in another order", () => {
    expect(onlyCreditOrderChanged([art, writer, band], [writer, art, band])).toBe(true);
  });

  it("is false when nothing moved", () => {
    expect(onlyCreditOrderChanged([writer, art], [writer, art])).toBe(false);
  });

  it("is false when a credit was edited, added or removed", () => {
    expect(onlyCreditOrderChanged([{ ...art, display_name: "Someone" }, writer], [writer, art])).toBe(false);
    expect(onlyCreditOrderChanged([art, writer, { role_key: "producer", display_name: "New" }], [writer, art])).toBe(false);
    expect(onlyCreditOrderChanged([art], [writer, art])).toBe(false);
  });

  it("ignores spaces around names and empty values, as the API does", () => {
    expect(onlyCreditOrderChanged([{ role_key: "custom", display_name: " Aryan ", instrument: "Artwork", artist_id: "" }, writer], [writer, art])).toBe(true);
  });
});

describe("moveTo", () => {
  it("moves an item and shifts the others", () => {
    expect(moveTo(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTo(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the list alone for the same or an impossible place", () => {
    const list = ["a", "b"];
    expect(moveTo(list, 1, 1)).toBe(list);
    expect(moveTo(list, 0, 5)).toBe(list);
  });
});

describe("dropIndex", () => {
  const middles = [10, 30, 50, 70];
  it("counts the other rows above the pointer", () => {
    expect(dropIndex(middles, 0, 5)).toBe(0);
    expect(dropIndex(middles, 0, 55)).toBe(2);
    expect(dropIndex(middles, 3, 20)).toBe(1);
    expect(dropIndex(middles, 1, 100)).toBe(3);
  });
});
