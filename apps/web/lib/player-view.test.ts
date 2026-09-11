import { describe, expect, it } from "vitest";

import { applyPlayerCommand, initialPlayerState, progressRatio } from "./player-view";

describe("listener player commands", () => {
  it("plays, pauses, seeks, and reports progress against a catalog version", () => {
    let state = initialPlayerState();
    state = applyPlayerCommand(state, {
      type: "load",
      trackId: "track-1",
      trackVersionId: "version-1",
      durationMs: 10000,
    });
    state = applyPlayerCommand(state, { type: "play" });
    expect(state.status).toBe("playing");
    state = applyPlayerCommand(state, { type: "tick", positionMs: 2500 });
    expect(state.positionMs).toBe(2500);
    expect(progressRatio(state)).toBe(0.25);
    state = applyPlayerCommand(state, { type: "seek", positionMs: 8000 });
    expect(state.positionMs).toBe(8000);
    state = applyPlayerCommand(state, { type: "pause" });
    expect(state.status).toBe("paused");
    state = applyPlayerCommand(state, { type: "play" });
    state = applyPlayerCommand(state, { type: "ended" });
    expect(state.status).toBe("ended");
    expect(state.trackVersionId).toBe("version-1");
  });

  it("does not invent royalty eligibility from progress", () => {
    const state = applyPlayerCommand(initialPlayerState(), {
      type: "load",
      trackId: "track-1",
      trackVersionId: "version-1",
      durationMs: 30000,
    });
    expect(state).not.toHaveProperty("eligible");
    expect(state).not.toHaveProperty("royalty");
  });
});
