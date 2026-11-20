// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { pastedPieces, selectionText } from "./rich-editor";

const values = { first_name: "Ishmamul", buyer_name: "Ishmamul Haque", artist: "MIZULS", music: "Chaya Pore", gift: "A signed card" };

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe("copying and pasting fill-ins (owner, 2026-11-20: one buyer's name went to everyone)", () => {
  it("copies a fill-in as {first_name}, never as the previewed buyer's name", () => {
    const root = document.createElement("div");
    root.contentEditable = "true";
    root.append(pastedPieces("Hi {first_name}, see [the map](https://example.com/map).", values));
    document.body.append(root);
    expect(root.textContent).toContain("Ishmamul");
    const range = document.createRange();
    range.selectNodeContents(root);
    window.getSelection()!.addRange(range);
    expect(selectionText(root)).toBe("Hi {first_name}, see [the map](https://example.com/map).");
  });

  it("turns pasted {first_name} back into a fill-in", () => {
    const holder = document.createElement("div");
    holder.append(pastedPieces("Dear {first_name},\nThanks", values));
    const chip = holder.querySelector<HTMLElement>("[data-fill]");
    expect(chip?.dataset.fill).toBe("first_name");
    expect(chip?.textContent).toBe("Ishmamul");
    expect(holder.querySelector("br")).toBeTruthy();
  });

  it("ignores a selection outside the editor", () => {
    const root = document.createElement("div");
    const other = document.createElement("p");
    other.textContent = "elsewhere";
    document.body.append(root, other);
    const range = document.createRange();
    range.selectNodeContents(other);
    window.getSelection()!.addRange(range);
    expect(selectionText(root)).toBeNull();
  });
});
