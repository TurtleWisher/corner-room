// @vitest-environment jsdom
/* Teaser Studio editor (owner, 2026-11-07, D-TEASER-00 to D-TEASER-03): typed times and keys move the
 * teaser within the limits, undo and "back to saved" work, and saving sends exactly what is shown. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/studio", useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

const teasers = vi.hoisted(() => ({
  fetchTeaser: vi.fn(),
  fetchWaveform: vi.fn(async () => ({ status: "READY", track_version_id: "v", points: Array.from({ length: 1800 }, (_, i) => i % 255), bucket_ms: 100, duration_ms: 180000 })),
  saveTeaserDraft: vi.fn(),
  processTeaser: vi.fn(),
  transitionTeaser: vi.fn(),
  renameTeaser: vi.fn(),
  deleteTeaser: vi.fn(),
  fetchStudioSongAudio: vi.fn(),
  fetchStudioVersionAudio: vi.fn(),
}));
vi.mock("@/features/teasers/api", async (orig) => ({ ...(await orig<typeof import("@/features/teasers/api")>()), ...teasers }));

import type { TeaserDetailRecord } from "@/features/teasers/api";

import { TeaserEditor } from "./teaser-editor";

const DETAIL: TeaserDetailRecord = {
  id: "tz1",
  title: null,
  status: "DRAFT",
  track_id: "song1",
  track_title: "Night Song",
  track_status: "RELEASED",
  release_id: "rel1",
  release_title: "Night Bus",
  published_at: null,
  master: { version_id: "v", status: "READY", duration_ms: 180000, processing_detail: null },
  versions: [
    {
      id: "ver1",
      number: 1,
      start_ms: 10000,
      end_ms: 40000,
      fade_in_ms: 0,
      fade_out_ms: 0,
      gain_cdb: 0,
      status: "DRAFT",
      failure_code: null,
      duration_ms: null,
      review_status: null,
      review_note: null,
      submitted_at: null,
      published_at: null,
      retired_at: null,
      is_live: false,
      created_at: "2026-11-07T00:00:00Z",
    },
  ],
  latest_version_id: "ver1",
  actions: ["process", "delete"],
  limits: { min_ms: 5000, max_ms: 60000, fade_max_ms: 10000, gain_min_cdb: -1200, gain_max_cdb: 600 },
  counts: { starts: 0, completes: 0, prompt_clicks: 0 },
};

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement["getContext"];
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  teasers.fetchTeaser.mockResolvedValue(DETAIL);
  teasers.saveTeaserDraft.mockImplementation(async (_id: string, s: object) => ({ ...DETAIL, versions: [{ ...DETAIL.versions[0], ...s }] }));
});
afterEach(cleanup);

async function open() {
  render(<TeaserEditor teaserId="tz1" releaseId="rel1" />);
  await screen.findByRole("heading", { name: "Choose the part" });
}

describe("TeaserEditor", () => {
  it("moves the start by typing and by the arrow keys, within the limits", async () => {
    await open();
    const start = screen.getByLabelText("Start") as HTMLInputElement;
    expect(start.value).toBe("0:10.000");
    await act(async () => {
      fireEvent.change(start, { target: { value: "0:20" } });
      fireEvent.blur(start);
    });
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("0:20.000");
    const handle = await screen.findByRole("slider", { name: "Teaser end" });
    await act(async () => fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true }));
    expect((screen.getByLabelText("End") as HTMLInputElement).value).toBe("0:41.000");
    // Never longer than 60 s: the start follows the end.
    const end = screen.getByLabelText("End") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(end, { target: { value: "2:00" } });
      fireEvent.blur(end);
    });
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("1:00.000");
    expect(screen.getByText("60.0 s")).toBeTruthy();
  });

  it("refuses a time it can't read, undoes, and saves exactly what is shown", async () => {
    await open();
    const start = screen.getByLabelText("Start") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(start, { target: { value: "ten" } });
      fireEvent.blur(start);
    });
    expect(screen.getByText("Type a time like 1:05.250")).toBeTruthy();
    await act(async () => {
      fireEvent.change(start, { target: { value: "15.5" } });
      fireEvent.blur(start);
    });
    await act(async () => screen.getByRole("button", { name: "Undo" }).click());
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("0:10.000");
    await act(async () => screen.getByRole("button", { name: "Redo" }).click());
    await act(async () => screen.getByRole("button", { name: /Save settings/ }).click());
    expect(teasers.saveTeaserDraft).toHaveBeenCalledWith("tz1", { start_ms: 15500, end_ms: 40000, fade_in_ms: 0, fade_out_ms: 0, gain_cdb: 0 });
  });

  it("explains a master that isn't ready instead of showing the editor", async () => {
    teasers.fetchTeaser.mockResolvedValue({ ...DETAIL, master: { ...DETAIL.master, status: "PROCESSING" } });
    render(<TeaserEditor teaserId="tz1" releaseId="rel1" />);
    expect(await screen.findByText("The song's master isn't ready.")).toBeTruthy();
  });
});
