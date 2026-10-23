// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const restore = vi.fn();
const apiLogout = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, restoreSession: () => restore(), logout: () => apiLogout() };
});

import { AuthProvider, useAuth } from "./auth-provider";

const fan = { id: "u1", email: "fan@example.com", display_name: "Fan" } as never;

function Who() {
  const { status, user, logout } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="email">{(user as { email?: string } | null)?.email ?? "none"}</p>
      <button type="button" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  );
}

beforeEach(() => {
  restore.mockReset();
  apiLogout.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("AuthProvider sign-out safety (security audit 2026-10-23)", () => {
  it("asks the API again when the page comes back from the back/forward cache", async () => {
    restore.mockResolvedValueOnce(fan);
    render(
      <AuthProvider>
        <Who />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("email").textContent).toBe("fan@example.com"));

    // Signed out elsewhere meanwhile: the API no longer restores the session.
    restore.mockResolvedValueOnce(null);
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(screen.getByTestId("email").textContent).toBe("none"); // hidden at once, before the API answers
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anonymous"));
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it("ignores an ordinary page show", async () => {
    restore.mockResolvedValueOnce(fan);
    render(
      <AuthProvider>
        <Who />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("signs out the other tabs of this browser", async () => {
    restore.mockResolvedValueOnce(fan);
    render(
      <AuthProvider>
        <Who />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    const otherTab = new BroadcastChannel("cr-auth");
    otherTab.postMessage("signed-out");
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anonymous"));
    expect(screen.getByTestId("email").textContent).toBe("none");
    otherTab.close();
  });

  it("tells other tabs when this tab signs out, even if the API call fails", async () => {
    restore.mockResolvedValueOnce(fan);
    apiLogout.mockRejectedValueOnce(new Error("offline"));
    const heard = vi.fn();
    const listener = new BroadcastChannel("cr-auth");
    listener.onmessage = (event) => heard(event.data);
    render(
      <AuthProvider>
        <Who />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authenticated"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    screen.getByRole("button", { name: "Sign out" }).click();
    await waitFor(() => expect(heard).toHaveBeenCalledWith("signed-out"));
    expect(screen.getByTestId("status").textContent).toBe("anonymous");
    listener.close();
    process.off("unhandledRejection", unhandled);
  });
});
