import { describe, expect, it } from "vitest";

import { Protected } from "@/components/protected";
import { ErrorState, LoadingState } from "@/components/async-state";
import { resolveProtectedView } from "@/lib/auth-view";

describe("protected route primitives", () => {
  it("exposes protected, loading, and error states for auth UX", () => {
    expect(typeof Protected).toBe("function");
    expect(typeof LoadingState).toBe("function");
    expect(typeof ErrorState).toBe("function");
  });

  it("keeps protected routes behind an explicit session check", () => {
    expect(resolveProtectedView("loading", null).kind).toBe("loading");
    expect(resolveProtectedView("anonymous", null).kind).toBe("unauthenticated");
    expect(resolveProtectedView("expired", { permissions: ["audit.read"] }).kind).toBe(
      "unauthenticated",
    );
    expect(resolveProtectedView("authenticated", { permissions: [] }, "audit.read").kind).toBe(
      "forbidden",
    );
    expect(resolveProtectedView("authenticated", { permissions: ["audit.read"] }, "audit.read").kind).toBe(
      "ok",
    );
  });
});
