import { describe, expect, it } from "vitest";

import { barKeyAction, pageKeepsKeys, playedShare, upNext } from "./player-keys-view";

const none = {};
const body = { tag: "BODY" };

describe("barKeyAction", () => {
  it("maps the usual keys on a normal page", () => {
    expect(barKeyAction(" ", none, body, "/store")).toBe("toggle");
    expect(barKeyAction("k", none, body, "/")).toBe("toggle");
    expect(barKeyAction("ArrowLeft", none, body, "/")).toBe("back");
    expect(barKeyAction("ArrowRight", none, body, "/")).toBe("forward");
    expect(barKeyAction("m", none, body, "/")).toBe("mute");
    expect(barKeyAction("N", { shift: true }, body, "/")).toBe("next");
    expect(barKeyAction("P", { shift: true }, body, "/")).toBe("previous");
  });

  it("never takes a key while someone is typing", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) expect(barKeyAction(" ", none, { tag }, "/")).toBeNull();
    expect(barKeyAction("m", none, { tag: "DIV", editable: true }, "/")).toBeNull();
    expect(barKeyAction("k", none, { tag: "DIV", role: "textbox" }, "/")).toBeNull();
  });

  it("leaves Space and arrows to the control that has focus", () => {
    expect(barKeyAction(" ", none, { tag: "BUTTON" }, "/")).toBeNull();
    expect(barKeyAction(" ", none, { tag: "A" }, "/")).toBeNull();
    expect(barKeyAction("ArrowRight", none, { tag: "DIV", role: "slider" }, "/")).toBeNull();
    expect(barKeyAction("ArrowRight", none, { tag: "BUTTON", role: "tab" }, "/")).toBeNull();
  });

  it("ignores browser shortcuts and unknown keys", () => {
    expect(barKeyAction("k", { ctrl: true }, body, "/")).toBeNull();
    expect(barKeyAction("ArrowLeft", { alt: true }, body, "/")).toBeNull();
    expect(barKeyAction("m", { meta: true }, body, "/")).toBeNull();
    expect(barKeyAction("x", none, body, "/")).toBeNull();
    expect(barKeyAction("M", { shift: true }, body, "/")).toBeNull();
  });

  it("stays out of pages that use the same keys", () => {
    expect(pageKeepsKeys("/listen/abc")).toBe(true);
    expect(pageKeepsKeys("/staff/catalog/lyrics-timing/abc")).toBe(true);
    expect(pageKeepsKeys("/studio/releases/r1/previews/t1")).toBe(true);
    expect(pageKeepsKeys("/listen")).toBe(false);
    expect(pageKeepsKeys("/studio/releases/r1/previews")).toBe(false);
    expect(barKeyAction(" ", none, body, "/listen/abc")).toBeNull();
  });
});

describe("playedShare", () => {
  it("is a share between nothing and everything", () => {
    expect(playedShare(30, 120)).toBe(0.25);
    expect(playedShare(500, 120)).toBe(1);
    expect(playedShare(-4, 120)).toBe(0);
  });
  it("is nothing while the length is unknown", () => {
    expect(playedShare(10, 0)).toBe(0);
    expect(playedShare(10, Number.NaN)).toBe(0);
  });
});

describe("upNext", () => {
  it("lists what follows the current song with its place", () => {
    expect(upNext(["a", "b", "c"], 0)).toEqual([
      { item: "b", at: 1 },
      { item: "c", at: 2 },
    ]);
    expect(upNext(["a", "b", "c"], 2)).toEqual([]);
    expect(upNext(["a"], -1)).toEqual([]);
  });
});
