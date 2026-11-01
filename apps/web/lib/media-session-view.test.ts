import { describe, expect, it } from "vitest";

import { MEDIA_FALLBACK_ARTIST, mediaSessionInfo } from "@/lib/media-session-view";

const ORIGIN = "https://www.cornerroom.live";

describe("mediaSessionInfo", () => {
  it("shows the title, artist and where the play came from", () => {
    const info = mediaSessionInfo({ id: "t1", title: "Chaya Pore", artist: "MIZULS" }, "Chaya Pore EP", ORIGIN, "");
    expect(info.title).toBe("Chaya Pore");
    expect(info.artist).toBe("MIZULS");
    expect(info.album).toBe("Chaya Pore EP");
  });

  it("never leaves the artist line empty or reading null", () => {
    expect(mediaSessionInfo({ id: "t1", title: "A" }, null, ORIGIN, "").artist).toBe(MEDIA_FALLBACK_ARTIST);
    expect(mediaSessionInfo({ id: "t1", title: "A", artist: null }, null, ORIGIN, "").artist).toBe(MEDIA_FALLBACK_ARTIST);
    expect(mediaSessionInfo({ id: "t1", title: "A", artist: "null" }, null, ORIGIN, "").artist).toBe(MEDIA_FALLBACK_ARTIST);
    expect(mediaSessionInfo({ id: "t1", title: "A", artist: "  " }, null, ORIGIN, "").artist).toBe(MEDIA_FALLBACK_ARTIST);
  });

  it("gives an untitled song a title and drops an album line that repeats it", () => {
    const info = mediaSessionInfo({ id: "t1", title: " " }, "null", ORIGIN, "");
    expect(info.title).toBe("Untitled");
    expect(info.album).toBe("");
    expect(mediaSessionInfo({ id: "t1", title: "Night Bus" }, "Night Bus", ORIGIN, "").album).toBe("");
  });

  it("offers every cover size as an absolute address", () => {
    const info = mediaSessionInfo({ id: "t1", title: "A" }, null, ORIGIN, "");
    expect(info.artwork).toEqual([
      { src: `${ORIGIN}/api/v1/covers/tracks/t1/160`, sizes: "160x160" },
      { src: `${ORIGIN}/api/v1/covers/tracks/t1/480`, sizes: "480x480" },
      { src: `${ORIGIN}/api/v1/covers/tracks/t1/1200`, sizes: "1200x1200" },
    ]);
  });

  it("keeps an API on another host as it is", () => {
    const info = mediaSessionInfo({ id: "t1", title: "A" }, null, ORIGIN, "https://api.example.com");
    expect(info.artwork[0].src).toBe("https://api.example.com/api/v1/covers/tracks/t1/160");
  });
});
