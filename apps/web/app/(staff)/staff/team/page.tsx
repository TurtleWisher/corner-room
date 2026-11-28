"use client";

/* Staff accounts (owner, 2026-11-28, D-STAFF-ACCOUNTS-01, URL-15). Admins and the owner only. */

import { Protected } from "@/components/staff/kit";
import { StaffAccountsPage } from "@/components/staff/staff-accounts";

export default function StaffTeamPage() {
  return (
    <Protected permission="user.admin">
      <StaffAccountsPage />
    </Protected>
  );
}
