import { StaffMain } from "@/components/staff/kit";
import { StaffShell } from "@/components/shell/staff-shell";

/* Staff console: side navigation, the always-visible "Acting in" workspace chip, graphite pages. */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffShell>
      <StaffMain>{children}</StaffMain>
    </StaffShell>
  );
}
