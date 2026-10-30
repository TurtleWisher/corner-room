import { describe, expect, it } from "vitest";

import type { ReleaseRecord, TrackRecord } from "@/lib/api";

import { collectionLabel, tracksEntries } from "./tracks-view";

const release = (id: string, type: string, at: string, status = "RELEASED"): ReleaseRecord => ({ id, title: id, release_type: type, status, release_at: at });
const track = (id: string, release_ids: string[] = []): TrackRecord => ({ id, title: id, status: "RELEASED", release_ids });

describe("tracksEntries (owner, 2026-10-30)", () => {
  const releases = [release("album", "ALBUM", "2026-10-29T00:00:00Z"), release("single", "SINGLE", "2026-10-25T00:00:00Z"), release("draft", "EP", "2026-10-30T00:00:00Z", "DRAFT")];

  it("shows an album once with its songs, singles as songs, newest first", () => {
    const out = tracksEntries([track("a1", ["album"]), track("a2", ["album"]), track("chaya", ["single"])], releases);
    expect(out.map((e) => (e.kind === "album" ? `album:${e.release.id}:${e.trackIds.join(",")}` : `song:${e.track.id}:${e.releaseIds.join(",")}`))).toEqual([
      "album:album:a1,a2",
      "song:chaya:single",
    ]);
  });

  it("keeps a single that is also on an album, and songs on no release, as songs", () => {
    const out = tracksEntries([track("both", ["single", "album"]), track("loose"), track("unreleased", ["draft"])], releases);
    expect(out.map((e) => (e.kind === "album" ? `album:${e.trackIds.join(",")}` : `song:${e.track.id}`))).toEqual([
      "album:both",
      "song:both",
      "song:loose",
      "song:unreleased",
    ]);
    const both = out.find((e) => e.kind === "song" && e.track.id === "both");
    expect(both?.kind === "song" && both.releaseIds).toEqual(["single", "album"]);
  });

  it("is empty without songs", () => {
    expect(tracksEntries([], releases)).toEqual([]);
  });
});

describe("collectionLabel", () => {
  it("names the kind and counts the songs", () => {
    expect(collectionLabel("ALBUM", 8)).toBe("Album · 8 songs");
    expect(collectionLabel("ep", 1)).toBe("EP · 1 song");
    expect(collectionLabel("LIVE", 3)).toBe("Live album · 3 songs");
    expect(collectionLabel(null, 2)).toBe("Release · 2 songs");
  });
});
