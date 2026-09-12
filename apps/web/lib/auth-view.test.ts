import { describe, expect, it } from "vitest";

import { loginFormState, resolveProtectedView, staffNavFlags } from "./auth-view";

describe("login form state", () => {
  it("shows loading while submitting", () => {
    expect(loginFormState(true, null)).toBe("loading");
  });

  it("shows error after a failed login", () => {
    expect(loginFormState(false, "Invalid email or password")).toBe("error");
  });

  it("is idle before submit", () => {
    expect(loginFormState(false, null)).toBe("idle");
  });
});

describe("protected route view", () => {
  const user = { permissions: ["audit.read"] };

  it("shows loading while session is restoring", () => {
    expect(resolveProtectedView("loading", null).kind).toBe("loading");
  });

  it("requires sign-in for anonymous visitors", () => {
    expect(resolveProtectedView("anonymous", null)).toEqual({
      kind: "unauthenticated",
      reason: "anonymous",
    });
  });

  it("treats a cleared access token as session expiration", () => {
    expect(resolveProtectedView("expired", null)).toEqual({
      kind: "unauthenticated",
      reason: "expired",
    });
  });

  it("allows an authenticated user onto a protected page", () => {
    expect(resolveProtectedView("authenticated", user).kind).toBe("ok");
  });

  it("forbids an authenticated user missing a required permission", () => {
    expect(resolveProtectedView("authenticated", user, "role.admin").kind).toBe("forbidden");
  });
});

describe("staff nav is UX-only", () => {
  it("shows analytics from analytics.read without granting finance", () => {
    expect(staffNavFlags(["analytics.read"])).toEqual({
      showAnalytics: true,
      showFinance: false,
    });
  });

  it("shows finance only when finance.read is present", () => {
    expect(staffNavFlags(["finance.read", "analytics.read"])).toEqual({
      showAnalytics: true,
      showFinance: true,
    });
  });
});
