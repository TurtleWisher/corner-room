import { describe, expect, it } from "vitest";

import { coverUrl } from "./cover-view";
import { changeLines, decisionLine, draftBio, draftName, photoOutputSide, photoProblem, squareCrop, type ChangeRequest } from "./profile-view";

const request = (over: Partial<ChangeRequest> = {}): ChangeRequest => ({
  id: "r1",
  status: "PENDING",
  stage_name: null,
  bio: null,
  bio_changed: false,
  portrait_url: null,
  remove_portrait: false,
  submitted_at: null,
  reviewed_at: null,
  review_note: null,
  ...over,
});

describe("profile pictures", () => {
  it("crops the middle square of a photo", () => {
    expect(squareCrop(3000, 4000)).toEqual({ sx: 0, sy: 500, side: 3000 });
    expect(squareCrop(1600, 900)).toEqual({ sx: 350, sy: 0, side: 900 });
    expect(squareCrop(500, 500)).toEqual({ sx: 0, sy: 0, side: 500 });
  });
  it("scales big photos down and keeps small ones", () => {
    expect(photoOutputSide(3000)).toBe(2000);
    expect(photoOutputSide(640)).toBe(640);
  });
  it("turns down photos under 400 px before uploading", () => {
    expect(photoProblem(399, 1000)).toMatch(/at least 400 × 400 px/);
    expect(photoProblem(400, 400)).toBeNull();
    expect(photoProblem(0, 0)).toMatch(/couldn't be read/);
  });
  it("builds artist and band picture addresses only when there is one", () => {
    expect(coverUrl({ artist: "a1", picture: "p9" }, 480, "")).toBe("/api/v1/covers/artists/a1/480?v=p9");
    expect(coverUrl({ band: "b1", picture: "p9" }, 160, "")).toBe("/api/v1/covers/bands/b1/160?v=p9");
    expect(coverUrl({ artist: "a1", picture: null }, 480, "")).toBeNull();
  });
});

describe("artist profile changes", () => {
  it("lists what a waiting request changes", () => {
    expect(changeLines(null)).toEqual([]);
    expect(changeLines(request({ stage_name: "Rumi", bio_changed: true, bio: "Hi", portrait_url: "/x" }))).toEqual([
      "Stage name: Rumi",
      "A new bio",
      "A new picture",
    ]);
    expect(changeLines(request({ stage_name: "Night Shift", bio_changed: true, remove_portrait: true }), "band")).toEqual([
      "Band name: Night Shift",
      "Remove the bio",
      "Remove the picture",
    ]);
  });
  it("tells the artist the last decision, with staff's note", () => {
    expect(decisionLine(request({ status: "APPROVED" }))?.tone).toBe("good");
    expect(decisionLine(request({ status: "REJECTED", review_note: "Too blurry" }))?.text).toMatch(/Too blurry/);
    expect(decisionLine(request({ status: "WITHDRAWN" }))).toBeNull();
  });
  it("fills the form from what is waiting, else what is public", () => {
    expect(draftName("Rumi Test", null)).toBe("Rumi Test");
    expect(draftName("Rumi Test", request({ stage_name: "Rumi" }))).toBe("Rumi");
    expect(draftBio("Old", request())).toBe("Old");
    expect(draftBio("Old", request({ bio_changed: true, bio: null }))).toBe("");
    expect(draftBio(null, null)).toBe("");
  });
});
