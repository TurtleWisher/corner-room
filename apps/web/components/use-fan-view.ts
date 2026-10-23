"use client";

import { useCallback, useSyncExternalStore } from "react";

import { FAN_VIEW_EVENT, FAN_VIEW_KEY, readFanView, writeFanView } from "@/lib/fan-view";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === FAN_VIEW_KEY || e.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(FAN_VIEW_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(FAN_VIEW_EVENT, onChange);
  };
}

/** Fan view on this device (lib/fan-view.ts), kept in step across components and tabs. */
export function useFanView(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => readFanView(storage()), () => false);
  const set = useCallback((next: boolean) => {
    writeFanView(storage(), next);
    window.dispatchEvent(new Event(FAN_VIEW_EVENT));
  }, []);
  return [on, set];
}
