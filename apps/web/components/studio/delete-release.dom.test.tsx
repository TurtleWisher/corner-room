// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ deleteStudioRelease: vi.fn() }));
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/features/studio/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/studio/api")>()), ...api }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

import { ApiError } from "@/lib/api/client";
import type { StudioReleaseDetail } from "@/features/studio/api";
import { DeleteRelease } from "./delete-release";

const detail = (status: string) => ({ release: { id: "r1", title: "Meghe Dhaka", status } }) as unknown as StudioReleaseDetail;

beforeEach(() => {
  api.deleteStudioRelease.mockReset();
  nav.push.mockReset();
});
afterEach(cleanup);

describe("Delete release (DOM)", () => {
  it("asks first, deletes, then goes back to Studio", async () => {
    api.deleteStudioRelease.mockResolvedValue(undefined);
    render(<DeleteRelease detail={detail("IN_PRODUCTION")} />);
    fireEvent.click(screen.getByRole("button", { name: /Delete this release/ }));
    expect(api.deleteStudioRelease).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Yes, delete it/ }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/studio"));
    expect(api.deleteStudioRelease).toHaveBeenCalledWith("r1");
  });

  it("explains a refusal once someone has paid", async () => {
    api.deleteStudioRelease.mockRejectedValue(new ApiError({ status: 409, title: "Conflict", code: "HAS_BUYERS", detail: "Someone has paid for this release" }));
    render(<DeleteRelease detail={detail("SCHEDULED")} />);
    fireEvent.click(screen.getByRole("button", { name: /Delete this release/ }));
    fireEvent.click(screen.getByRole("button", { name: /Yes, delete it/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Cancel its pre-sale first/));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("isn't offered for released music", () => {
    const { container } = render(<DeleteRelease detail={detail("RELEASED")} />);
    expect(container.textContent).toBe("");
  });
});
