import { describe, expect, it } from "vitest";

import { EMAIL_STUB_COPY, checkLabel, healthLabel, opsErrorKind } from "./ops-view";

describe("ops honesty", () => {
  it("keeps EMAIL STUB wording", () => {
    expect(EMAIL_STUB_COPY).toBe("EMAIL STUB");
    expect(checkLabel({ status: "NOT_CONFIGURED", honesty: EMAIL_STUB_COPY })).toBe(
      "NOT_CONFIGURED · EMAIL STUB",
    );
  });

  it("labels health statuses without inventing healthy vendors", () => {
    expect(healthLabel("DEGRADED")).toBe("DEGRADED");
    expect(checkLabel({ status: "NOT_AVAILABLE" })).toBe("NOT_AVAILABLE");
  });

  it("maps workspace and forbidden API codes", () => {
    expect(opsErrorKind("WORKSPACE_REQUIRED", 409)).toBe("workspace");
    expect(opsErrorKind(undefined, 403)).toBe("forbidden");
  });
});
