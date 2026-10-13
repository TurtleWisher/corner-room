import { describe, expect, it } from "vitest";

import type { PlayableTrackRecord } from "@/lib/api";

import { playQueue } from "./music-view";

function rec(id: string, ok = true): PlayableTrackRecord {
  return { id, title: `T-${id}`, catalog_playable: ok, audio_deliverable: ok, duration_ms: 1000, reason: ok ? null : "NO_AUDIO" } as PlayableTrackRecord;
}

describe("playQueue", () => {
  const playable = new Map([rec("a"), rec("b", false), rec("c"), rec("d")].map((r) => [r.id, r]));

  it("keeps the list's order and only what can be played now", () => {
    const q = playQueue(
      [{ trackId: "a", artist: "X" }, { trackId: "b" }, { trackId: "c", title: "Shown C" }, { trackId: "d" }, { trackId: "zz" }],
      playable,
      (id) => id !== "d",
    );
    expect(q).toEqual([
      { id: "a", title: "T-a", artist: "X" },
      { id: "c", title: "Shown C", artist: null },
    ]);
  });

  it("is empty when nothing can be played", () => {
    expect(playQueue([{ trackId: "b" }], playable, () => true)).toEqual([]);
  });
});
