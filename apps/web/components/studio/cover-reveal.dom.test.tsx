// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ setCoverReveal: vi.fn(), revealCoverNow: vi.fn() }));
vi.mock("@/features/studio/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/studio/api")>()), ...api }));

import type { StudioReleaseDetail } from "@/features/studio/api";
import { CoverReveal } from "./cover-reveal";

function detail(status: string, reveal: StudioReleaseDetail["cover_reveal"], cover = true): StudioReleaseDetail {
  return {
    release: { id: "r1", status, version: 3, release_at: "2026-11-10T14:00:00Z" },
    cover_url: cover ? "/api/v1/covers/signed/x/1200" : null,
    cover_reveal: reveal,
  } as unknown as StudioReleaseDetail;
}

beforeEach(() => {
  api.setCoverReveal.mockReset();
  api.revealCoverNow.mockReset();
});
afterEach(cleanup);

describe("Cover reveal (DOM)", () => {
  it("saves an early reveal time chosen from the list", async () => {
    const next = detail("SCHEDULED", { lead_minutes: 2880, reveal_at: "2026-11-08T14:00:00Z", can_change: true, can_reveal_now: true });
    api.setCoverReveal.mockResolvedValue(next);
    const reload = vi.fn();
    render(<CoverReveal detail={detail("SCHEDULED", { lead_minutes: null, can_change: true, can_reveal_now: true })} reload={reload} />);
    expect(screen.getByRole("status").textContent).toContain("when the release comes out");
    fireEvent.change(screen.getByLabelText(/Show the cover early/), { target: { value: "2880" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(reload).toHaveBeenCalledWith(next));
    expect(api.setCoverReveal).toHaveBeenCalledWith("r1", 2880);
  });

  it("asks before revealing now, then reveals", async () => {
    api.revealCoverNow.mockResolvedValue(detail("SCHEDULED", { revealed: true, revealed_at: "2026-11-02T10:00:00Z" }));
    const reload = vi.fn();
    render(<CoverReveal detail={detail("SCHEDULED", { lead_minutes: null, can_change: true, can_reveal_now: true })} reload={reload} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal now" }));
    expect(api.revealCoverNow).not.toHaveBeenCalled();
    expect(screen.getByText(/can't hide it again/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Yes, reveal it now" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(api.revealCoverNow).toHaveBeenCalledWith("r1");
  });

  it("says why Reveal now isn't open, and shows a revealed cover as final", () => {
    render(<CoverReveal detail={detail("APPROVED", { lead_minutes: null, can_change: true, can_reveal_now: false })} reload={vi.fn()} />);
    expect(screen.getByText(/once Corner Room sets your release date/)).toBeTruthy();
    cleanup();
    render(<CoverReveal detail={detail("SCHEDULED", { lead_minutes: null, can_change: true, can_reveal_now: false }, false)} reload={vi.fn()} />);
    expect(screen.getByText("Add a cover to reveal it early.")).toBeTruthy();
    cleanup();
    render(<CoverReveal detail={detail("SCHEDULED", { revealed: true, can_change: false })} reload={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("Fans see your cover now, under a light blur until release");
    expect(screen.queryByRole("button", { name: "Reveal now" })).toBeNull();
    expect(screen.queryByLabelText(/Show the cover early/)).toBeNull();
  });

  it("is not shown once the release is out", () => {
    const { container } = render(<CoverReveal detail={detail("RELEASED", { revealed: true })} reload={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
