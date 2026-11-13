import { describe, expect, it } from "vitest";

import { dateBlock, formatDate, formatDateTime, formatTime, resolveTimeZone } from "./date";

// 2025-10-17 14:00 UTC is 20:00 in Dhaka (UTC+6).
const ISO = "2025-10-17T14:00:00Z";

describe("event time zone", () => {
  it("shows the event's own zone, not the viewer's", () => {
    expect(formatTime(ISO, { timeZone: "Asia/Dhaka" })).toBe("8:00 PM");
    expect(formatTime(ISO, { timeZone: "Europe/London" })).toBe("3:00 PM");
  });
  it("labels the zone", () => {
    expect(resolveTimeZone("Asia/Dhaka")).toEqual({ timeZone: "Asia/Dhaka", label: "Dhaka time", fallback: false });
    expect(resolveTimeZone("America/New_York").label).toBe("New York time");
  });
  it("uses Dhaka time when no zone is given (D-TIME-01), labelled when a named zone is unusable", () => {
    expect(resolveTimeZone(undefined)).toEqual({ timeZone: "Asia/Dhaka", label: "Dhaka time", fallback: false });
    expect(resolveTimeZone("Mars/Base")).toEqual({ timeZone: "Asia/Dhaka", label: "Dhaka time", fallback: true });
    expect(formatDateTime("2026-11-12T18:00:00Z")).toBe("Fri 13 Nov 2026, 12:00 AM");
  });
});

describe("formatters", () => {
  it("formats date and date-time", () => {
    expect(formatDate(ISO, { timeZone: "Asia/Dhaka" })).toBe("Fri 17 Oct 2025");
    expect(formatDateTime(ISO, { timeZone: "Asia/Dhaka" })).toBe("Fri 17 Oct 2025, 8:00 PM");
  });
  it("builds the date block in the event zone", () => {
    expect(dateBlock("2025-10-17T19:30:00Z", { timeZone: "Asia/Dhaka" })).toMatchObject({
      weekday: "SAT",
      day: "18",
      month: "OCT",
    });
  });
  it("uses three-letter months", () => {
    expect(formatDate("2025-09-01T00:00:00Z", { timeZone: "Asia/Dhaka" })).toBe("Mon 1 Sep 2025");
    expect(dateBlock("2025-09-01T00:00:00Z", { timeZone: "Asia/Dhaka" })?.month).toBe("SEP");
  });
  it("returns null for missing or invalid input", () => {
    expect(formatDate(null)).toBeNull();
    expect(formatTime("not a date")).toBeNull();
    expect(dateBlock(undefined)).toBeNull();
  });
});
