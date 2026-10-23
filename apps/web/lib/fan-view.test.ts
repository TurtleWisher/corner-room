import { describe, expect, it } from "vitest";

import { FAN_VIEW_KEY, readFanView, writeFanView } from "./fan-view";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe("fan view", () => {
  it("is off until switched on, and off again after", () => {
    const store = memory();
    expect(readFanView(store)).toBe(false);
    writeFanView(store, true);
    expect(store.data.get(FAN_VIEW_KEY)).toBe("1");
    expect(readFanView(store)).toBe(true);
    writeFanView(store, false);
    expect(readFanView(store)).toBe(false);
  });

  it("reads as off when storage is missing or blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readFanView(null)).toBe(false);
    expect(readFanView(blocked)).toBe(false);
    expect(() => writeFanView(blocked, true)).not.toThrow();
  });
});
