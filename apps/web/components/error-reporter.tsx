"use client";

import { useEffect } from "react";

import { reportError } from "@/lib/error-report";

/** Listens for uncaught errors in the visitor's browser and reports them (D-ERR-01). Renders nothing. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportError("error", event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportError("unhandledrejection", event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
