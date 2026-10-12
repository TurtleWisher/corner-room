import { LegacyMain } from "@/components/shell/legacy-main";
import { StaffShell } from "@/components/shell/staff-shell";

/* Staff shell (Stage 5): side navigation and the always-visible workspace chip. */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffShell>
      <LegacyMain>{children}</LegacyMain>
    </StaffShell>
  );
}
