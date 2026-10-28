import { describe, expect, it } from "vitest";

import type { StudioReleaseDetail, StudioTrack } from "@/features/studio/api";

import { changeMode, pendingAudio, proposedRelease, proposedTrack } from "./changes-view";

const track = {
  id: "t1",
  position: 1,
  title: "Chaya Pore",
  version_title: null,
  status: "RELEASED",
  explicit: false,
  language_code: "bn",
  isrc: null,
  version: 3,
  audio: [],
  credits: [{ id: "c1", role_key: "songwriter", display_name: "Old Name", position: 0 }],
} as unknown as StudioTrack;

const base = {
  release: { id: "r1", status: "RELEASED", title: "Chaya Pore", label_name: null },
  change_request: null,
} as unknown as StudioReleaseDetail;

const withRequest = (status: string, changes: Record<string, unknown>) =>
  ({ ...base, change_request: { status, changes, diff: [], audio: [] } }) as unknown as StudioReleaseDetail;

describe("changeMode (owner, 2026-10-28)", () => {
  it("tells drafts, released music without changes, changes being made and changes sent apart", () => {
    expect(changeMode({ ...base, release: { ...base.release, status: "IN_PRODUCTION" } } as StudioReleaseDetail)).toBe("not_released");
    expect(changeMode(base)).toBe("none");
    expect(changeMode(withRequest("OPEN", {}))).toBe("editing");
    expect(changeMode(withRequest("SUBMITTED", {}))).toBe("waiting");
  });
});

describe("proposed values", () => {
  const detail = withRequest("OPEN", {
    release: { title: "Chaya Pore (Remastered)" },
    tracks: {
      t1: {
        fields: { title: "Chaya Pore (2026 mix)", explicit: true },
        credits: [{ role_key: "songwriter", display_name: "New Name" }],
        audio_version_id: "v9",
      },
    },
  });

  it("shows what is proposed over what is public", () => {
    expect(proposedRelease(detail).title).toBe("Chaya Pore (Remastered)");
    const shown = proposedTrack(detail, track);
    expect(shown.title).toBe("Chaya Pore (2026 mix)");
    expect(shown.explicit).toBe(true);
    expect(shown.language_code).toBe("bn");
    expect(shown.credits.map((c) => c.display_name)).toEqual(["New Name"]);
    expect(pendingAudio(detail, "t1")).toBe("v9");
  });

  it("leaves everything as it is without a request", () => {
    expect(proposedRelease(base).title).toBe("Chaya Pore");
    expect(proposedTrack(base, track)).toBe(track);
    expect(pendingAudio(base, "t1")).toBeNull();
  });
});
