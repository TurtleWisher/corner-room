import { describe, expect, it } from "vitest";

import { inAppPath, isListeningRoom, wantsRoomTransition, type LinkClick } from "./room-transition-view";

const click = (over: Partial<LinkClick> = {}): LinkClick => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  target: null,
  download: false,
  href: "/listen/t1",
  ...over,
});
const origin = "https://www.cornerroom.live";

describe("listening room transition (owner, 2026-10-31)", () => {
  it("knows the room from the Listen tab", () => {
    expect(isListeningRoom("/listen/t1")).toBe(true);
    expect(isListeningRoom("/listen")).toBe(false);
    expect(isListeningRoom("/tracks/t1")).toBe(false);
    expect(isListeningRoom(null)).toBe(false);
  });

  it("animates only moves into or out of the room", () => {
    expect(wantsRoomTransition("/tracks/t1", "/listen/t1")).toBe(true);
    expect(wantsRoomTransition("/listen/t1", "/artists/a1")).toBe(true);
    expect(wantsRoomTransition("/listen/t1", "/listen/t2")).toBe(true);
    expect(wantsRoomTransition("/", "/events")).toBe(false);
    expect(wantsRoomTransition("/listen/t1", "/listen/t1")).toBe(false);
  });

  it("takes over only plain clicks on links inside the app", () => {
    expect(inAppPath(click(), origin)).toBe("/listen/t1");
    expect(inAppPath(click({ href: "https://www.cornerroom.live/tracks/t1?x=1#c" }), origin)).toBe("/tracks/t1?x=1#c");
    expect(inAppPath(click({ ctrlKey: true }), origin)).toBeNull();
    expect(inAppPath(click({ button: 1 }), origin)).toBeNull();
    expect(inAppPath(click({ target: "_blank" }), origin)).toBeNull();
    expect(inAppPath(click({ download: true }), origin)).toBeNull();
    expect(inAppPath(click({ defaultPrevented: true }), origin)).toBeNull();
    expect(inAppPath(click({ href: "https://example.com/listen/t1" }), origin)).toBeNull();
    expect(inAppPath(click({ href: null }), origin)).toBeNull();
  });
});
