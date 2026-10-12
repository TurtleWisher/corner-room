"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";

export type AsyncState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ok"; data: T; error: null }
  | { status: "error"; data: null; error: ApiError | Error };

/**
 * Load data on mount and when `deps` change; stale responses are dropped. `reload` re-runs it.
 * Errors keep the ApiError so pages can tell 401, 403 and 404 apart.
 */
export function useAsync<T>(load: () => Promise<T>, deps: React.DependencyList): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading", data: null, error: null });
  const run = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(() => {
    const id = ++run.current;
    setState((s) => (s.status === "ok" ? s : { status: "loading", data: null, error: null }));
    loader
      .current()
      .then((data) => {
        if (id === run.current) setState({ status: "ok", data, error: null });
      })
      .catch((error: unknown) => {
        if (id === run.current) setState({ status: "error", data: null, error: error instanceof Error ? error : new Error("Request failed") });
      });
  }, []);

  useEffect(() => {
    setState({ status: "loading", data: null, error: null });
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the values the loader reads
  }, deps);

  return { ...state, reload };
}

/** Friendly copy for a failed load, never internal details. */
export function loadErrorMessage(error: unknown, what: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return `Sign in to see ${what}.`;
    if (error.status === 403) return `You do not have access to ${what}.`;
    if (error.status === 404) return `We could not find ${what}.`;
  }
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} could not be loaded. Please try again.`;
}
