// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/music/credits", () => ({ useCredits: () => ({ artists: [], bands: [] }) }));

import type { HomeFeature } from "@/lib/home-view";

import { FeaturedCarousel } from "./featured-carousel";

const slides: HomeFeature[] = [
  { kind: "event", label: "Next up", event: { id: "e1", venue_id: null, title: "Rooftop Night", description: null, status: "TICKETING_OPEN", timezone: "Asia/Dhaka", starts_at: "2026-11-02T14:00:00Z", ends_at: null } },
  { kind: "release", label: "New release", release: { id: "r1", title: "Chaya Pore", release_type: "SINGLE", status: "RELEASED", release_at: "2026-10-26T06:00:00Z" } },
  { kind: "release", label: "New release", release: { id: "r2", title: "Low Tide", release_type: "SINGLE", status: "RELEASED", release_at: "2026-10-20T06:00:00Z" } },
];

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(cleanup);

const current = () => screen.getAllByRole("group").find((g) => !g.hasAttribute("aria-hidden"));

describe("FeaturedCarousel (owner, 2026-10-31)", () => {
  it("shows one cover in front at a time and moves with the arrows, wrapping round", () => {
    render(<FeaturedCarousel slides={slides} />);
    expect(screen.getByRole("region", { name: "Featured" })).toBeTruthy();
    expect(current()?.getAttribute("aria-label")).toBe("1 of 3: Rooftop Night");
    expect(screen.getAllByRole("group").filter((g) => !g.hasAttribute("aria-hidden"))).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(current()?.getAttribute("aria-label")).toBe("2 of 3: Chaya Pore");
    expect(screen.getByText("New release")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(current()?.getAttribute("aria-label")).toBe("3 of 3: Low Tide");
  });

  it("turns to the next slide when the progress line fills, and pauses while pointed at", () => {
    const { container } = render(<FeaturedCarousel slides={slides} />);
    const region = screen.getByRole("region", { name: "Featured" });
    fireEvent.pointerEnter(region);
    expect(region.hasAttribute("data-paused")).toBe(true);
    fireEvent.pointerLeave(region);
    expect(region.hasAttribute("data-paused")).toBe(false);

    act(() => {
      fireEvent.animationEnd(container.querySelector(".home-feature-fill") as Element);
    });
    expect(current()?.getAttribute("aria-label")).toBe("2 of 3: Chaya Pore");
  });

  it("jumps straight to a slide from the progress line, and with the arrow keys", () => {
    render(<FeaturedCarousel slides={slides} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 3 of 3: Low Tide" }));
    expect(current()?.getAttribute("aria-label")).toBe("3 of 3: Low Tide");
    fireEvent.keyDown(screen.getByRole("region", { name: "Featured" }), { key: "ArrowRight" });
    expect(current()?.getAttribute("aria-label")).toBe("1 of 3: Rooftop Night");
  });

  it("swipes on touch screens without opening the cover", () => {
    render(<FeaturedCarousel slides={slides} />);
    const stage = document.querySelector(".home-feature-stage") as Element;
    fireEvent.touchStart(stage, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 100, clientY: 104 }] });
    expect(current()?.getAttribute("aria-label")).toBe("2 of 3: Chaya Pore");
  });

  it("still turns by itself with Reduce Motion on (owner, 2026-11-02: iPhones looked stuck)", () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
    const { container } = render(<FeaturedCarousel slides={slides} />);
    act(() => {
      fireEvent.animationEnd(container.querySelector(".home-feature-fill") as Element);
    });
    expect(current()?.getAttribute("aria-label")).toBe("2 of 3: Chaya Pore");
  });

  it("ends the touch pause when the finger lifts outside the cover", () => {
    render(<FeaturedCarousel slides={slides} />);
    const region = screen.getByRole("region", { name: "Featured" });
    fireEvent.touchStart(document.querySelector(".home-feature-stage") as Element, { touches: [{ clientX: 200, clientY: 100 }] });
    expect(region.hasAttribute("data-paused")).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("touchend"));
    });
    expect(region.hasAttribute("data-paused")).toBe(false);
  });

  it("has no arrows or progress line for a single feature", () => {
    render(<FeaturedCarousel slides={slides.slice(0, 1)} />);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(document.querySelector(".home-feature-steps")).toBeNull();
  });
});
