import { describe, expect, it } from "vitest";

import { canSuspend, canUnsuspend, adminErrorKind } from "./admin-view";

describe("admin inspect", () => {
  it("only offers suspend/reactivate for existing states", () => {
    expect(canSuspend("ACTIVE")).toBe(true);
    expect(canUnsuspend("SUSPENDED")).toBe(true);
    expect(canSuspend("CLOSED")).toBe(false);
    expect(canUnsuspend("ACTIVE")).toBe(false);
  });

  it("maps missing permission and missing resource", () => {
    expect(adminErrorKind("FORBIDDEN", 403)).toBe("forbidden");
    expect(adminErrorKind("NOT_FOUND", 404)).toBe("not_found");
  });
});
