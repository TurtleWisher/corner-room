import { describe, expect, it } from "vitest";

import { opensAnotherPage, skipsEntrance, trickle } from "./nav-progress-view";

describe("opensAnotherPage", () => {
  it("is true for another path or another query", () => {
    expect(opensAnotherPage("/store", "/events")).toBe(true);
    expect(opensAnotherPage("/studio/mailbox?box=sent", "/studio/mailbox?box=write")).toBe(true);
  });
  it("is false for the same page, a trailing slash or only a new part of it", () => {
    expect(opensAnotherPage("/store", "/store")).toBe(false);
    expect(opensAnotherPage("/store", "/store/")).toBe(false);
    expect(opensAnotherPage("/", "/#welcome")).toBe(false);
    expect(opensAnotherPage("/studio/releases/r1", "/studio/releases/r1#presale")).toBe(false);
    expect(opensAnotherPage("/store", null)).toBe(false);
  });
});

describe("trickle", () => {
  it("starts empty, grows, and never finishes by itself", () => {
    expect(trickle(0)).toBe(0);
    expect(trickle(-5)).toBe(0);
    expect(trickle(300)).toBeGreaterThan(0.2);
    expect(trickle(2000)).toBeGreaterThan(trickle(300));
    expect(trickle(600_000)).toBeLessThanOrEqual(0.9);
  });
});

describe("skipsEntrance", () => {
  it("leaves the listening room to its own entrance", () => {
    expect(skipsEntrance("/listen/abc")).toBe(true);
    expect(skipsEntrance("/listen")).toBe(false);
    expect(skipsEntrance("/store")).toBe(false);
    expect(skipsEntrance(null)).toBe(false);
  });
});
