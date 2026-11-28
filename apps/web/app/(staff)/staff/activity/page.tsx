"use client";

/* Staff activity (owner, 2026-11-28, URL-15): who did what, from the audit log. */

import { Suspense } from "react";

import { LoadingState, Protected } from "@/components/staff/kit";
import { StaffActivityPage } from "@/components/staff/staff-activity";

export default function StaffActivityRoute() {
  return (
    <Protected permission="audit.read">
      <Suspense fallback={<LoadingState label="Loading staff activity" />}>
        <StaffActivityPage />
      </Suspense>
    </Protected>
  );
}
