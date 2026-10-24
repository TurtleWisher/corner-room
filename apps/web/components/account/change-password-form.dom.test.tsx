// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const change = vi.fn();
vi.mock("@/features/identity/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/identity/api")>();
  return { ...actual, changePassword: (...args: unknown[]) => change(...args) };
});

import { ApiError } from "@/lib/api";
import { ChangePasswordForm } from "./change-password-form";

async function submit(current: string, next: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Type the new password again"), confirm);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

beforeEach(() => {
  // Block body: a returned function would be run as a teardown.
  change.mockReset();
});
afterEach(cleanup);

describe("ChangePasswordForm (DOM)", () => {
  it("sends the current and new password and confirms the change", async () => {
    change.mockResolvedValue(undefined);
    render(<ChangePasswordForm email="fan@example.com" name="Fan" />);
    await submit("oldpassword1", "newpassword34", "newpassword34");
    await waitFor(() => expect(screen.getByText(/Password changed/)).toBeTruthy());
    expect(change).toHaveBeenCalledWith("oldpassword1", "newpassword34");
  });

  it("says when the current password is wrong, without signing anyone out", async () => {
    change.mockRejectedValue(new ApiError({ status: 401, code: "UNAUTHORIZED" }));
    render(<ChangePasswordForm />);
    await submit("wrongpass1", "newpassword34", "newpassword34");
    expect(await screen.findByText("That is not your current password.")).toBeTruthy();
  });

  it("checks the new password before sending anything", async () => {
    render(<ChangePasswordForm />);
    await submit("oldpassword1", "short", "short");
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  });

  it("offers the reset link for Google sign-ups and forgotten passwords", () => {
    render(<ChangePasswordForm />);
    expect(screen.getByRole("link", { name: "Get a reset link by email" }).getAttribute("href")).toBe("/forgot-password");
  });
});
