import { describe, expect, it } from "vitest";

import {
  ANALYTICS_TIMEZONE_NOTE,
  MONEY_TILE_COPY,
  NO_DATA_PERIOD,
  UNIQUE_LISTENERS_COPY,
  WORKSPACE_REQUIRED_COPY,
  analyticsErrorKind,
  attributionDisplay,
  countDisplay,
  isUnavailableMetric,
  moneyTileLabel,
  periodHasCounts,
  uniqueListenersLabel,
} from "./analytics-view";

describe("analytics honesty", () => {
  it("labels money as not available in analytics", () => {
    expect(moneyTileLabel("NOT_AVAILABLE")).toBe(MONEY_TILE_COPY);
    expect(MONEY_TILE_COPY).toBe("Not available in analytics");
  });

  it("labels unique listeners as not available, never a invented count", () => {
    expect(uniqueListenersLabel("NOT_AVAILABLE")).toBe(UNIQUE_LISTENERS_COPY);
    expect(isUnavailableMetric("NOT_AVAILABLE")).toBe(true);
    expect(isUnavailableMetric(0)).toBe(false);
  });

  it("shows ATTRIBUTION_UNDEFINED as such and never as 0%", () => {
    expect(attributionDisplay("ATTRIBUTION_UNDEFINED")).toBe("ATTRIBUTION_UNDEFINED");
    expect(attributionDisplay("ATTRIBUTION_UNDEFINED")).not.toBe("0%");
  });

  it("does not flash zeros while loading", () => {
    expect(countDisplay(0, true)).toEqual({ skeleton: true, text: null });
    expect(countDisplay(0, false)).toEqual({ skeleton: false, text: "0" });
  });

  it("distinguishes a zero period from unavailable metrics", () => {
    expect(periodHasCounts([0, 0])).toBe(false);
    expect(periodHasCounts([0, 1])).toBe(true);
    expect(NO_DATA_PERIOD).toBe("No data for this period.");
  });

  it("maps workspace and date-range API codes to existing UX", () => {
    expect(analyticsErrorKind("WORKSPACE_REQUIRED", 409)).toBe("workspace");
    expect(analyticsErrorKind("INVALID_DATE_RANGE", 400)).toBe("range");
    expect(analyticsErrorKind(undefined, 404)).toBe("not_found");
    expect(WORKSPACE_REQUIRED_COPY).toBe("Select a workspace");
  });

  it("states the assumed Asia/Dhaka metric timezone", () => {
    expect(ANALYTICS_TIMEZONE_NOTE).toContain("Asia/Dhaka");
  });
});
