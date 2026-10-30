"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { reportError } from "@/lib/error-report";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A page that crashed is reported once (D-ERR-01); the visitor still sees only this message.
  useEffect(() => reportError("boundary", error), [error]);
  return (
    <div className="space-y-4">
      <ErrorState
        title="This page could not be loaded"
        message="Please try again. Internal details are not shown."
      />
      <Button type="button" onClick={reset}>
        Try again
      </Button>
      <p className="sr-only">{error.name}</p>
    </div>
  );
}
