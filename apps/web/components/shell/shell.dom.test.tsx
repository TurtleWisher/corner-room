// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Shell components read three contexts and the router. Each test sets the state it needs. */
const auth = { status: "authenticated", user: null as null | { permissions?: string[]; display_name?: string | null }, logout: vi.fn() };
const workspace = {
  organizations: [] as { id: string; name: string }[],
  currentOrg: null as null | { id: string; name: string },
  loading: false,
  error: null as string | null,
  switchTo: vi.fn(async () => {}),
};
let pathname = "/staff/ops";

vi.mock("@/components/auth-provider", () => ({ useAuth: () => auth }));
vi.mock("@/components/workspace-provider", () => ({ useWorkspace: () => workspace }));
vi.mock("@/components/notifications-provider", () => ({ useNotifications: () => ({ items: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useSearchParams: () => new URLSearchParams() }));

import { MobileTabBar } from "./mobile-tab-bar";
import { StaffShell } from "./staff-shell";
import { WorkspaceChip } from "./workspace-chip";

beforeAll(() => {
  // jsdom has no <dialog> modal support.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  auth.status = "authenticated";
  auth.user = { permissions: [] };
  workspace.organizations = [];
  workspace.currentOrg = null;
  workspace.loading = false;
  workspace.error = null;
  workspace.switchTo.mockClear();
  pathname = "/staff/ops";
});
afterEach(cleanup);

describe("WorkspaceChip", () => {
  it("names the active workspace from the session", () => {
    workspace.organizations = [{ id: "o1", name: "Corner Room Label" }];
    workspace.currentOrg = workspace.organizations[0];
    render(<WorkspaceChip />);
    expect(screen.getByRole("button", { name: /Acting in\s*Corner Room Label/ })).toBeTruthy();
  });

  it("says so when no workspace is selected, and when signed out", () => {
    const { rerender } = render(<WorkspaceChip />);
    expect(screen.getByText("No workspace selected")).toBeTruthy();
    auth.status = "anonymous";
    rerender(<WorkspaceChip />);
    expect(screen.getByText("Not signed in")).toBeTruthy();
  });

  it("switches through the provider, never on its own", async () => {
    workspace.organizations = [
      { id: "o1", name: "Platform" },
      { id: "o2", name: "Label" },
    ];
    workspace.currentOrg = workspace.organizations[0];
    render(<WorkspaceChip />);
    await userEvent.click(screen.getByRole("button", { name: /Acting in/ }));
    const current = screen.getByRole("button", { name: /^Platform/ });
    expect((current as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Label" }));
    expect(workspace.switchTo).toHaveBeenCalledWith("o2");
  });
});

describe("StaffShell", () => {
  it("marks the current page and keeps gated links hidden without permission", () => {
    auth.user = { permissions: ["audit.read"] };
    render(
      <StaffShell>
        <p>content</p>
      </StaffShell>,
    );
    const nav = screen.getAllByRole("navigation", { name: "Staff" })[0];
    const ops = Array.from(nav.querySelectorAll("a")).find((a) => a.textContent?.trim() === "Ops");
    expect(ops?.getAttribute("aria-current")).toBe("page");
    expect(Array.from(nav.querySelectorAll("a")).some((a) => a.textContent?.trim() === "Finance")).toBe(false);
    expect(screen.getByText("content")).toBeTruthy();
    expect(screen.getAllByText("Admin").length).toBeGreaterThan(0);
  });
});

describe("MobileTabBar", () => {
  it("offers sign-in to guests and account to signed-in users", () => {
    auth.status = "anonymous";
    auth.user = null;
    pathname = "/discover";
    const { rerender } = render(<MobileTabBar />);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Events" }).getAttribute("aria-current")).toBe("page");
    auth.status = "authenticated";
    auth.user = { permissions: [] };
    rerender(<MobileTabBar />);
    expect(screen.getByRole("button", { name: "You" })).toBeTruthy();
  });
});
