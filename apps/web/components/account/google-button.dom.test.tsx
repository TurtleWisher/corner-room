// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchAuthProviders: () => providers() };
});

import { GoogleButton, GoogleSignInOption } from "./google-button";

beforeEach(() => providers.mockReset());
afterEach(cleanup);

describe("GoogleButton (DOM)", () => {
  it("is a keyboard-reachable link to the API start, carrying only a safe next path", async () => {
    render(<GoogleButton next="/checkout?offer=1" />);
    const link = screen.getByRole("link", { name: "Continue with Google" });
    const url = new URL(link.getAttribute("href")!);
    expect(url.pathname).toBe("/api/v1/auth/google/start");
    expect(url.searchParams.get("next")).toBe("/checkout?offer=1");
    expect([...url.searchParams.keys()]).toEqual(["next"]);
    await userEvent.setup().tab();
    expect(document.activeElement).toBe(link);
  });

  it("drops an off-site next path", () => {
    render(<GoogleButton next="//evil.example" />);
    const href = screen.getByRole("link").getAttribute("href")!;
    expect(new URL(href).searchParams.get("next")).toBe("/account");
  });

  it("shows progress after the first click and ignores a second one", async () => {
    render(<GoogleButton />);
    const link = screen.getByRole("link", { name: "Continue with Google" });
    link.addEventListener("click", (e) => e.preventDefault()); // keep jsdom from navigating
    link.click();
    await waitFor(() => expect(screen.getByRole("link", { name: "Opening Google…" })).toBeTruthy());
    const busy = screen.getByRole("link", { name: "Opening Google…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    const second = new MouseEvent("click", { bubbles: true, cancelable: true });
    busy.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
  });
});

describe("GoogleSignInOption (DOM)", () => {
  it("renders the button and the divider only when Google is switched on", async () => {
    providers.mockResolvedValue({ google: true });
    render(<GoogleSignInOption next="/library" />);
    expect(await screen.findByRole("link", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.getByTestId("auth-or").getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing when Google is off or the check fails", async () => {
    providers.mockResolvedValueOnce({ google: false });
    const { container, unmount } = render(<GoogleSignInOption />);
    await waitFor(() => expect(providers).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
    unmount();
    providers.mockRejectedValueOnce(new Error("offline"));
    const second = render(<GoogleSignInOption />);
    await waitFor(() => expect(providers).toHaveBeenCalledTimes(2));
    expect(second.container.innerHTML).toBe("");
  });
});
