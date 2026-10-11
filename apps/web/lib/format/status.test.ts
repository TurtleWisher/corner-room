import { describe, expect, it } from "vitest";

import { defineStatusMap, humanizeStatus, resolveStatus } from "./status";

describe("status labels", () => {
  const map = defineStatusMap({ POSTED: { label: "Posted", tone: "positive" } });

  it("uses the module map when the value is known", () => {
    expect(resolveStatus(map, "POSTED")).toEqual({ label: "Posted", tone: "positive" });
  });
  it("never breaks on an unknown API value", () => {
    expect(resolveStatus(map, "AWAITING_SECOND_APPROVAL")).toEqual({ label: "Awaiting second approval", tone: "neutral" });
    expect(resolveStatus(undefined, "on-sale")).toEqual({ label: "On sale", tone: "neutral" });
  });
  it("returns null for empty values", () => {
    expect(resolveStatus(map, "")).toBeNull();
    expect(resolveStatus(map, null)).toBeNull();
  });
  it("humanises", () => {
    expect(humanizeStatus("SOLD_OUT")).toBe("Sold out");
  });
});
