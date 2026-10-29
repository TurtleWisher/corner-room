// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchArtists: vi.fn(), fetchBands: vi.fn() }));
vi.mock("@/lib/api", () => api);

import { resetCreditsForTest, useCredits } from "./credits";

const NASH = { id: "a1", stage_name: "NASH MUSIC" };
const RUMI = { id: "a2", stage_name: "Rumi" };

function Names() {
  const { artists } = useCredits();
  return <p>{artists.map((a) => a.stage_name).join(", ") || "none"}</p>;
}

beforeEach(() => {
  resetCreditsForTest();
  api.fetchBands.mockResolvedValue({ items: [], next_cursor: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useCredits", () => {
  it("picks up an artist added after the first page, without a reload", async () => {
    api.fetchArtists.mockResolvedValueOnce({ items: [RUMI], next_cursor: null });
    render(<Names />);
    await screen.findByText("Rumi");
    cleanup();

    api.fetchArtists.mockResolvedValueOnce({ items: [RUMI, NASH], next_cursor: null });
    render(<Names />);
    // The last good list shows at once, then the fresh one replaces it.
    expect(screen.getByText("Rumi")).toBeTruthy();
    await screen.findByText("Rumi, NASH MUSIC");
  });

  it("does not remember a failed request as an empty list", async () => {
    api.fetchArtists.mockRejectedValueOnce(new Error("offline"));
    render(<Names />);
    await waitFor(() => expect(api.fetchArtists).toHaveBeenCalledTimes(1));
    await screen.findByText("none");
    cleanup();

    api.fetchArtists.mockResolvedValueOnce({ items: [NASH], next_cursor: null });
    render(<Names />);
    await screen.findByText("NASH MUSIC");
  });

  it("keeps the last good list when a refresh fails", async () => {
    api.fetchArtists.mockResolvedValueOnce({ items: [NASH], next_cursor: null });
    render(<Names />);
    await screen.findByText("NASH MUSIC");
    cleanup();

    api.fetchArtists.mockRejectedValueOnce(new Error("offline"));
    render(<Names />);
    await waitFor(() => expect(api.fetchArtists).toHaveBeenCalledTimes(2));
    expect(screen.getByText("NASH MUSIC")).toBeTruthy();
  });

  it("shares one request between parts of the same page", async () => {
    api.fetchArtists.mockResolvedValue({ items: [NASH], next_cursor: null });
    render(
      <>
        <Names />
        <Names />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText("NASH MUSIC")).toHaveLength(2));
    expect(api.fetchArtists).toHaveBeenCalledTimes(1);
  });
});
