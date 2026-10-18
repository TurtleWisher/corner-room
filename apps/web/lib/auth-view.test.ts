import { describe, expect, it } from "vitest";

import { loginFormState, resolveProtectedView, safeNextPath, signInPageFrom, staffNavFlags, verifyLinkFor, withNext } from "./auth-view";

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

  it("shows staff only to a signed-in fan or artist (no workspace, no staff permissions)", () => {
    expect(resolveProtectedView("authenticated", { permissions: [], has_workspace: false }).kind).toBe("not_staff");
    expect(resolveProtectedView("authenticated", { has_workspace: true, permissions: [] }).kind).toBe("ok");
  });
});

describe("staff nav is UX-only", () => {
  it("shows analytics from analytics.read without granting finance", () => {
    expect(staffNavFlags(["analytics.read"])).toEqual({
      showAnalytics: true,
      showFinance: false,
      showOps: false,
      showUsers: false,
      showOrgs: false,
    });
  });

  it("shows finance only when finance.read is present", () => {
    expect(staffNavFlags(["finance.read", "analytics.read"])).toEqual({
      showAnalytics: true,
      showFinance: true,
      showOps: false,
      showUsers: false,
      showOrgs: false,
    });
  });

  it("shows ops and admin inspect from existing permissions only", () => {
    expect(staffNavFlags(["audit.read", "user.admin", "org.admin"])).toEqual({
      showAnalytics: false,
      showFinance: false,
      showOps: true,
      showUsers: true,
      showOrgs: true,
    });
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/checkout?offer=1")).toBe("/checkout?offer=1");
  });
  it("rejects anything that could leave the site", () => {
    for (const bad of ["//evil.test", "https://evil.test", "/\\evil.test", "javascript:alert(1)", "evil.test", "", null, undefined]) {
      expect(safeNextPath(bad)).toBe("/account");
    }
  });
});

describe("withNext", () => {
  it("carries a safe destination and keeps a fragment last", () => {
    expect(withNext("/login", "/artists/apply")).toBe("/login?next=%2Fartists%2Fapply");
    expect(withNext("/verify#token=abc", "/studio")).toBe("/verify?next=%2Fstudio#token=abc");
    expect(withNext("/login", "https://evil.example")).toBe("/login");
    expect(withNext("/login", "//evil.example")).toBe("/login");
    expect(withNext("/login", null)).toBe("/login");
  });
});

describe("verifyLinkFor", () => {
  it("keeps the sign-in page and the destination apart", () => {
    expect(verifyLinkFor("/verify#token=t", "/artists/apply", "/login")).toBe("/verify?next=%2Fartists%2Fapply#token=t");
    expect(verifyLinkFor("/verify#token=t", "/studio/join?code=c", "/studio/sign-in")).toBe(
      "/verify?next=%2Fstudio%2Fjoin%3Fcode%3Dc&signin=%2Fstudio%2Fsign-in#token=t",
    );
    expect(signInPageFrom("/staff/sign-in")).toBe("/staff/sign-in");
    expect(signInPageFrom("https://evil.example")).toBe("/login");
  });
});

