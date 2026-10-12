import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader, SkipLink } from "@/components/shell/site-header";

/* Public shell: Ember header, footer, bottom tab bar on phones. Modules set data-module per page. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col [&>main]:flex-1">
      <SkipLink />
      <SiteHeader />
      {children}
      <SiteFooter />
      <MobileTabBar />
    </div>
  );
}
