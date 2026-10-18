import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import { friendlyError } from "@/lib/error-copy";

const err = (code: string, status: number, detail = "Family plans are P1 (Q-P1-27 / Q-P9-10)") =>
  new ApiError({ code, status, detail });

describe("friendlyError", () => {
  it("maps known codes to customer copy and never shows the API detail", () => {
    const message = friendlyError(err("SUBSCRIPTION_EXISTS", 409));
    expect(message).toBe("You already have an active subscription.");
    expect(message).not.toMatch(/Q-P|P1/);
  });
  it("explains purchase refusals in plain words", () => {
    expect(friendlyError(err("TRACK_NOT_SOLD_SEPARATELY", 409))).toBe("This song is sold only as part of its album or EP.");
    expect(friendlyError(err("DELIVERY_ADDRESS_REQUIRED", 409))).toMatch(/Bangladesh address/);
    expect(friendlyError(err("ORDER_CANCELLED", 409))).toMatch(/start again/);
  });
  it("falls back by status, then to a generic line", () => {
    expect(friendlyError(err("SOMETHING_NEW", 404))).toBe("We could not find that.");
    expect(friendlyError(err("SOMETHING_NEW", 500))).toBe("Something went wrong. Please try again.");
    expect(friendlyError(new Error("boom"), "Custom")).toBe("Custom");
  });
});

describe("signInError", () => {
  it("names each sign-in outcome", async () => {
    const { signInError } = await import("@/lib/error-copy");
    expect(signInError(err("UNAUTHENTICATED", 401))).toMatch(/do not match/);
    expect(signInError(err("ACCOUNT_NOT_ACTIVE", 403))).toBe("Your account is not verified yet.");
    expect(signInError(err("ACCOUNT_LOCKED", 403))).toMatch(/locked/);
  });
});

describe("googleSignInError", () => {
  it("explains each refusal in plain words and never echoes the raw code", async () => {
    const { googleSignInError } = await import("@/lib/error-copy");
    expect(googleSignInError(null)).toBeNull();
    expect(googleSignInError("cancelled")).toMatch(/cancelled/);
    expect(googleSignInError("link_requires_password")).toMatch(/Verify it first/);
    expect(googleSignInError("account_not_active")).toMatch(/not active/);
    const unknown = googleSignInError("<script>alert(1)</script>");
    expect(unknown).toMatch(/did not work/);
    expect(unknown).not.toMatch(/script/);
  });
});
