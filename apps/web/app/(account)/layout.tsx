import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader, SkipLink } from "@/components/shell/site-header";
import { ACCOUNT_NAV } from "@/lib/nav-view";

/* Account shell: Ember with the quiet "Front Door" light (styles/modules/account.css). */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-module="account" className="flex min-h-dvh flex-col [&>main]:flex-1">
      <SkipLink />
      <SiteHeader subnav={ACCOUNT_NAV} subnavLabel="Your account" subnavAuthOnly />
      {children}
      <SiteFooter />
      <MobileTabBar />
    </div>
  );
}
