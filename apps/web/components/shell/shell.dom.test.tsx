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
const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push }) }));
const fetchMyProfiles = vi.fn(async () => [] as { kind: string; id: string; display_name: string; status: string; can_publish: boolean }[]);
vi.mock("@/features/studio/api", () => ({ fetchMyProfiles: () => fetchMyProfiles() }));

import { AccountMenu } from "./account-menu";
import { MobileTabBar } from "./mobile-tab-bar";
import { SiteHeader } from "./site-header";
import { StaffShell } from "./staff-shell";
import { StudioShell } from "./studio-shell";
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

describe("Beta label", () => {
  it("sits beside the logo in every header, outside the logo's home link (owner, 2026-10-25)", () => {
    const beside = (container: HTMLElement) =>
      Array.from(container.querySelectorAll("a")).filter((a) => a.querySelector('img[src*="corner-room-logo"]')).map((a) => a.nextElementSibling?.textContent);
    const views = [
      render(<SiteHeader />),
      render(<SiteHeader world="sky" />),
      render(
        <StaffShell>
          <p>content</p>
        </StaffShell>,
      ),
      render(
        <StudioShell>
          <main id="main">page</main>
        </StudioShell>,
      ),
    ];
    for (const { container } of views) {
      const labels = beside(container);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every((t) => t === "Beta")).toBe(true);
    }
    // The links keep their names, so "Beta" is read as its own word.
    expect(screen.getAllByRole("link", { name: "Corner Room home" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Artist Studio home" }).length).toBeGreaterThan(0);
  });
});

describe("MobileTabBar", () => {
  it("offers sign-in to guests and account to signed-in users", () => {
    auth.status = "anonymous";
    auth.user = null;
    pathname = "/events";
    const { rerender } = render(<MobileTabBar />);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Events" }).getAttribute("aria-current")).toBe("page");
    auth.status = "authenticated";
    auth.user = { permissions: [] };
    rerender(<MobileTabBar />);
    expect(screen.getByRole("button", { name: "You" })).toBeTruthy();
  });
});

describe("StudioShell", () => {
  it("is the mint world with the artist's real profiles, Studio places and a way back", async () => {
    pathname = "/studio/sales";
    fetchMyProfiles.mockResolvedValueOnce([
      { kind: "artist", id: "a1", display_name: "Rumi", status: "ACTIVE", can_publish: true },
      { kind: "band", id: "b1", display_name: "Kaal Bela", status: "ACTIVE", can_publish: true },
    ]);
    const { container } = render(
      <StudioShell>
        <main id="main">page</main>
      </StudioShell>,
    );
    expect(container.querySelector("aside")?.getAttribute("data-theme")).toBe("artist-studio");
    expect(container.querySelector('img[src$="corner-room-logo-artist-mint.svg"]')).toBeTruthy();
    const nav = screen.getAllByRole("navigation", { name: "Studio" })[0];
    // Plain label with a short hint under it (owner, 2026-10-30).
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain("Sales and buyers");
    expect(current?.textContent).toContain("What sold and who bought it");
    expect(await screen.findAllByText("Kaal Bela")).toBeTruthy();
    // Plays exist for artist profiles only.
    expect(nav.querySelector('a[href="/artists/a1/analytics"]')).toBeTruthy();
    expect(nav.querySelector('a[href="/artists/b1/analytics"]')).toBeNull();
    // The way back to the fan site is a clear switch (owner, 2026-10-24): header and side menu.
    const switches = screen.getAllByRole("button", { name: /Switch to fan view/ });
    expect(switches.length).toBeGreaterThan(1);
    await userEvent.setup().click(switches[0]);
    expect(window.localStorage.getItem("cr-fan-view")).toBe("1");
    expect(push).toHaveBeenCalledWith("/#welcome");
    window.localStorage.removeItem("cr-fan-view");
  });

  it("sends signed-out visitors to the artist sign-in", () => {
    auth.status = "anonymous";
    render(
      <StudioShell>
        <main id="main">page</main>
      </StudioShell>,
    );
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/studio/sign-in");
  });
});

describe("AccountMenu", () => {
  it("offers a small Staff only sign-in under the Artist section, except to staff", () => {
    auth.user = { permissions: [], display_name: "Fan" };
    const { unmount } = render(<AccountMenu open onClose={() => {}} />);
    const link = screen.getByRole("link", { name: "Staff only" });
    expect(link.getAttribute("href")).toBe("/staff/sign-in");
    // It sits after "Apply as an artist", in the same section.
    const apply = screen.getByRole("link", { name: /Apply as an artist/ });
    expect(apply.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    auth.user = { permissions: ["event.read"], display_name: "Ops" };
    render(<AccountMenu open onClose={() => {}} />);
    expect(screen.queryByRole("link", { name: "Staff only" })).toBeNull();
    expect(screen.getByRole("link", { name: /Staff console/ })).toBeTruthy();
  });
});
