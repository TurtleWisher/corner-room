"use client";

import { ErrorState } from "@/components/async-state";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
