import { describe, expect, it } from "vitest";

import {
  isCompletion,
  isTeaserKey,
  ownedLink,
  suggestionFor,
  teaserKey,
  teaserLabel,
  teaserLength,
} from "./teaser-room-view";

const base = {
  track_title: "Night Song",
  release_title: "Night Bus",
  release_at: "2026-12-01T12:00:00Z",
  track_released: true,
};

describe("teaser keys", () => {
  it("keeps a teaser apart from its song in the player", () => {
    expect(teaserKey("t1")).toBe("teaser:t1");
    expect(isTeaserKey("teaser:t1")).toBe(true);
    expect(isTeaserKey("t1")).toBe(false);
    expect(isTeaserKey(null)).toBe(false);
  });
});

describe("isCompletion", () => {
  it("needs most of the teaser actually heard", () => {
    expect(isCompletion(27_000, 30)).toBe(true);
    expect(isCompletion(26_999, 30)).toBe(false);
    expect(isCompletion(500, 30)).toBe(false); // dragged to the end
  });
  it("never counts unknown lengths or failed loads", () => {
    expect(isCompletion(10_000, 0)).toBe(false);
    expect(isCompletion(10_000, Number.NaN)).toBe(false);
    expect(isCompletion(Number.NaN, 30)).toBe(false);
  });
});

describe("suggestionFor", () => {
  it("offers nothing to owners", () => {
    expect(suggestionFor({ ...base, next_step: { kind: "OWNED", track_id: "s", release_id: "r" } })).toBeNull();
  });
  it("points at the existing pages, never a new checkout", () => {
    expect(suggestionFor({ ...base, next_step: { kind: "BUY", track_id: "s", release_id: "r" } })?.action).toEqual({
      label: "Buy the song",
      href: "/tracks/s",
    });
    expect(suggestionFor({ ...base, next_step: { kind: "BUY_RELEASE", track_id: "s", release_id: "r" } })?.action?.href).toBe(
      "/releases/r",
    );
    const pre = suggestionFor({ ...base, track_released: false, next_step: { kind: "PREBOOK", track_id: "s", release_id: "r" } });
    expect(pre?.action).toEqual({ label: "Pre-book", href: "/releases/r" });
    expect(pre?.eyebrow).toBe("Before release");
  });
  it("invents no offer when nothing is on sale", () => {
    const none = suggestionFor({ ...base, next_step: { kind: "NONE", track_id: "s", release_id: "r" } });
    expect(none?.action).toBeNull();
    expect(none?.body).toContain("isn't on sale");
    const early = suggestionFor({ ...base, track_released: false, next_step: { kind: "NONE", track_id: "s", release_id: "r" } });
    expect(early?.body).toContain("isn't out yet");
  });
});

describe("words", () => {
  it("says it is a teaser, and before release", () => {
    expect(teaserLabel({ title: null, track_released: true })).toBe("Teaser");
    expect(teaserLabel({ title: "Chorus", track_released: false })).toBe("Teaser · Chorus · before release");
  });
  it("formats lengths", () => {
    expect(teaserLength(45_400)).toBe("0:45");
    expect(teaserLength(60_000)).toBe("1:00");
    expect(teaserLength(null)).toBe("");
  });
  it("sends owners to the full song", () => {
    expect(ownedLink({ track_id: "s" })).toEqual({ label: "Play the full song", href: "/listen/s" });
  });
});
