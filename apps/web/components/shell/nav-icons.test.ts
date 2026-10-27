import { describe, expect, it } from "vitest";

import { staffNavSections } from "@/lib/nav-view";

import { hasNavIcon } from "./nav-icons";

describe("staff menu icons", () => {
  it("gives every staff menu entry an icon, so none is easy to miss (owner, 2026-10-28)", () => {
    const all = ["user.admin", "org.admin", "audit.read", "finance.read", "analytics.read"];
    const missing = staffNavSections(all)
      .flatMap((section) => section.items)
      .map((item) => item.href)
      .filter((href) => !hasNavIcon(href));
    expect(missing).toEqual([]);
  });
});
