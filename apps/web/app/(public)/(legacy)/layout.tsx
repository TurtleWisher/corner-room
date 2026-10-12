import { LegacyMain } from "@/components/shell/legacy-main";

/* Public pages not yet rebuilt. They move out of this group in their module stage. */
export default function PublicLegacyLayout({ children }: { children: React.ReactNode }) {
  return <LegacyMain>{children}</LegacyMain>;
}
