import { describe, expect, it } from "vitest";

import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";

describe("async UI states", () => {
  it("exposes loading, error, and empty primitives", () => {
    expect(typeof LoadingState).toBe("function");
    expect(typeof ErrorState).toBe("function");
    expect(typeof EmptyState).toBe("function");
  });
});
