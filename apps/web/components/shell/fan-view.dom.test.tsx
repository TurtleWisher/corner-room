// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FAN_VIEW_EVENT, FAN_VIEW_KEY } from "@/lib/fan-view";

import { StaffPanel } from "./staff-panel";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(FAN_VIEW_KEY);
});

describe("fan view (owner, 2026-10-24)", () => {
  it("hides staff tools on fan pages while it is on, and shows them again after", () => {
    render(<StaffPanel>Create a release</StaffPanel>);
    expect(screen.getByText("Create a release")).toBeTruthy();

    act(() => {
      window.localStorage.setItem(FAN_VIEW_KEY, "1");
      window.dispatchEvent(new Event(FAN_VIEW_EVENT));
    });
    expect(screen.queryByText("Create a release")).toBeNull();

    act(() => {
      window.localStorage.removeItem(FAN_VIEW_KEY);
      window.dispatchEvent(new Event(FAN_VIEW_EVENT));
    });
    expect(screen.getByText("Create a release")).toBeTruthy();
  });
});
