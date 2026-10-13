// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const offers = vi.fn();
const plans = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchOffers: () => offers(), fetchSubscriptionPlans: () => plans() };
});
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ status: "anonymous", user: null }) }));

import { Reveal } from "@/components/ds/reveal";
import { SiteFooter } from "@/components/shell/site-footer";

import { MISSION_LINE, MissionBand } from "./mission-band";
import { MAX_TILT_DEG, PosterTilt, tiltFor } from "./poster-tilt";

function media({ reduce = false, fine = true } = {}) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: (q.includes("reduce") && reduce) || (q.includes("pointer: fine") && fine),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
}

class IO {
  static last: IO | null = null;
  constructor(public cb: IntersectionObserverCallback) {
    IO.last = this;
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  media();
  offers.mockReset();
  plans.mockReset();
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IO;
});
afterEach(cleanup);

describe("tiltFor", () => {
  it("is flat at the centre and never exceeds the limit", () => {
    expect(tiltFor(50, 50, 100, 100)).toEqual({ tiltX: 0, tiltY: -0, glareX: 50, glareY: 50 });
    const corner = tiltFor(0, 0, 100, 100);
    expect(corner.tiltX).toBe(-MAX_TILT_DEG);
    expect(corner.tiltY).toBe(MAX_TILT_DEG);
    const far = tiltFor(500, -500, 100, 100);
    expect(Math.abs(far.tiltX)).toBeLessThanOrEqual(MAX_TILT_DEG);
    expect(Math.abs(far.tiltY)).toBeLessThanOrEqual(MAX_TILT_DEG);
    expect(tiltFor(10, 10, 0, 0).tiltX).toBe(0);
  });
});

describe("PosterTilt", () => {
  it("reacts to the pointer on a fine pointer without reduced motion", () => {
    render(<PosterTilt><span>poster</span></PosterTilt>);
    const el = screen.getByTestId("poster-tilt");
    fireEvent.pointerMove(el, { clientX: 10, clientY: 10 });
    expect(el.dataset.tilting).toBe("true");
    expect(el.style.getPropertyValue("--glare")).toBe("1");
    fireEvent.pointerLeave(el);
    expect(el.dataset.tilting).toBeUndefined();
  });

  it("does nothing on touch screens or under reduced motion", () => {
    for (const opts of [{ fine: false }, { reduce: true }]) {
      media(opts);
      const { unmount } = render(<PosterTilt><span>poster</span></PosterTilt>);
      const el = screen.getByTestId("poster-tilt");
      fireEvent.pointerMove(el, { clientX: 10, clientY: 10 });
      expect(el.dataset.tilting).toBeUndefined();
      expect(el.style.getPropertyValue("--glare")).toBe("");
      unmount();
    }
  });

  it("keeps the poster content as it is (light layers are decorative)", () => {
    render(<PosterTilt><button type="button">Next up: Low Tide</button></PosterTilt>);
    expect(screen.getByRole("button", { name: "Next up: Low Tide" })).toBeTruthy();
    for (const el of screen.getByTestId("poster-tilt").querySelectorAll(".home-poster-halo, .home-poster-edge")) {
      expect(el.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("Reveal", () => {
  it("never hides content under reduced motion", () => {
    media({ reduce: true });
    render(<Reveal>Visible</Reveal>);
    expect(screen.getByText("Visible").dataset.reveal).toBeUndefined();
  });

  it("leaves blocks that are already on screen alone", () => {
    render(<Reveal>On screen</Reveal>); // jsdom rects are 0, i.e. at the top of the viewport
    expect(screen.getByText("On screen").dataset.reveal).toBeUndefined();
  });

  it("holds back a block below the fold, then shows it once it enters", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000 } as DOMRect);
    render(<Reveal>Later</Reveal>);
    const el = screen.getByText("Later");
    expect(el.dataset.reveal).toBe("pending");
    IO.last?.cb([{ isIntersecting: true } as IntersectionObserverEntry], IO.last as never);
    expect(el.dataset.reveal).toBe("shown");
    rect.mockRestore();
  });
});

describe("MissionBand", () => {
  it("leads to the Store and shows only real store items", async () => {
    offers.mockResolvedValue({ items: [{ id: "pass", product_type: "CATALOG_ACCESS", status: "ACTIVE", name: "Full catalog pass", amount_minor: 90000, currency_code: "BDT" }] });
    plans.mockResolvedValue({ items: [{ id: "p", key: "monthly", status: "ACTIVE", price_amount_minor: 29900, currency_code: "BDT", interval: "MONTH", interval_count: 1 }] });
    render(<MissionBand />);
    expect(screen.getByRole("heading", { name: MISSION_LINE })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Visit the Store/ }).getAttribute("href")).toBe("/store");
    expect(await screen.findByText("Full catalog pass")).toBeTruthy();
    expect(screen.getByText("Monthly")).toBeTruthy();
  });

  it("shows no product tiles when the store has nothing on sale", async () => {
    offers.mockResolvedValue({ items: [] });
    plans.mockResolvedValue({ items: [] });
    render(<MissionBand />);
    await waitFor(() => expect(offers).toHaveBeenCalled());
    expect(screen.queryByRole("list", { name: "In the Store now" })).toBeNull();
  });
});

describe("SiteFooter", () => {
  it("keeps the brand lines and shows a contact placeholder, never invented details", () => {
    const { container } = render(<SiteFooter />);
    expect(screen.getByText("The city's corner. The music's room.")).toBeTruthy();
    expect(screen.getByText("Contact details coming soon.")).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]/i); // no email
    expect(text).not.toMatch(/\+?\d[\d\s-]{7,}/); // no phone number
    expect(screen.getByRole("link", { name: "Store" }).getAttribute("href")).toBe("/store");
  });
});
