// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reset = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, resetPassword: (...args: unknown[]) => reset(...args) };
});

import { ApiError } from "@/lib/api";
import ResetPasswordPage from "./page";

async function fill(password: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("New password"), password);
  await user.type(screen.getByLabelText("Type it again"), confirm);
  await user.click(screen.getByRole("button", { name: "Save the new password" }));
}

beforeEach(() => {
  reset.mockReset();
  window.history.replaceState(null, "", "/reset-password#token=abc123token");
});
afterEach(cleanup);

describe("Reset password page (DOM)", () => {
  it("takes the token out of the address bar and saves the new password with it", async () => {
    reset.mockResolvedValue(undefined);
    render(<ResetPasswordPage />);
    await waitFor(() => expect(window.location.hash).toBe(""));
    await fill("newpassword34", "newpassword34");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Password changed" })).toBeTruthy());
    expect(reset).toHaveBeenCalledWith("abc123token", "newpassword34");
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
  });

  it("points at the second field when the passwords differ, and sends nothing", async () => {
    render(<ResetPasswordPage />);
    await fill("newpassword34", "newpassword35");
    expect(screen.getByText("The two passwords do not match.")).toBeTruthy();
    expect(reset).not.toHaveBeenCalled();
  });

  it("offers a new link when the token has expired or was used", async () => {
    reset.mockRejectedValue(new ApiError({ status: 401, code: "UNAUTHORIZED" }));
    render(<ResetPasswordPage />);
    await fill("newpassword34", "newpassword34");
    await waitFor(() => expect(screen.getByText("This link has expired or was already used. Ask for a new one.")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Get a new link" }).getAttribute("href")).toBe("/forgot-password");
  });

  it("says the link is incomplete when it has no token", async () => {
    window.history.replaceState(null, "", "/reset-password");
    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByText("This link is incomplete. Ask for a new one.")).toBeTruthy());
  });
});
