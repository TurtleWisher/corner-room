import { describe, expect, it } from "vitest";

import { verifyPathFromLink } from "./api";

describe("verifyPathFromLink", () => {
  it("keeps the token in the fragment of a same-site path", () => {
    expect(verifyPathFromLink("http://localhost:3000/verify#token=abc_DEF-123")).toBe("/verify#token=abc_DEF-123");
  });

  it("ignores the link's host, so it can never send the visitor elsewhere", () => {
    expect(verifyPathFromLink("https://evil.example/verify#token=abc")).toBe("/verify#token=abc");
  });

  it("rejects missing or malformed tokens", () => {
    for (const bad of [null, undefined, "", "http://localhost:3000/verify", "http://x/verify#token=", "http://x/verify#token=a%22b", "http://x/verify#token=<script>"]) {
      expect(verifyPathFromLink(bad)).toBeNull();
    }
  });
});
