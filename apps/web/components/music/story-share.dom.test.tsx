// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchStoryCheck: vi.fn(),
  fetchTrackAudio: vi.fn(),
  resolveMediaUrl: (p: string) => p,
}));
vi.mock("@/features/streaming/api", () => api);
vi.mock("@/lib/api", () => ({ fetchTrack: vi.fn() }));
vi.mock("@/components/music/player", () => ({ usePlayer: () => ({ status: "idle", toggle: vi.fn() }) }));
// The video maker loads only when someone makes a video; never in these tests.
vi.mock("@/lib/story-video", () => ({ cutClip: vi.fn(), makeStoryVideo: vi.fn(), monoSamples: vi.fn() }));

import { StoryShareButton } from "./story-share";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StoryShareButton", () => {
  it("shows only when the server says this person may share", async () => {
    api.fetchStoryCheck.mockResolvedValueOnce({ track_id: "t1", can_share: true, reason: "OK", clip_max_ms: 30_000 });
    render(<StoryShareButton track={{ id: "t1", title: "ছায়া পড়ে", artist: "Act" }} />);
    expect(await screen.findByRole("button", { name: "Share ছায়া পড়ে as a story" })).toBeTruthy();
    expect(api.fetchStoryCheck).toHaveBeenCalledWith("t1");
  });

  it("stays away for people who can't, and when the check fails", async () => {
    api.fetchStoryCheck.mockResolvedValueOnce({ track_id: "t2", can_share: false, reason: "SHARING_OFF", clip_max_ms: 30_000 });
    const { container } = render(<StoryShareButton track={{ id: "t2", title: "Song" }} />);
    await waitFor(() => expect(api.fetchStoryCheck).toHaveBeenCalledWith("t2"));
    expect(container.querySelector("button")).toBeNull();

    api.fetchStoryCheck.mockRejectedValueOnce(new Error("401"));
    const other = render(<StoryShareButton track={{ id: "t3", title: "Song" }} />);
    await waitFor(() => expect(api.fetchStoryCheck).toHaveBeenCalledWith("t3"));
    expect(other.container.querySelector("button")).toBeNull();
  });

  it("asks once per song per page view", async () => {
    api.fetchStoryCheck.mockResolvedValue({ track_id: "t4", can_share: true, reason: "OK", clip_max_ms: 30_000 });
    render(<StoryShareButton track={{ id: "t4", title: "Song" }} />);
    render(<StoryShareButton track={{ id: "t4", title: "Song" }} />);
    await screen.findAllByRole("button", { name: "Share Song as a story" });
    expect(api.fetchStoryCheck).toHaveBeenCalledTimes(1);
  });
});
