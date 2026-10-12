import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader, SkipLink } from "@/components/shell/site-header";
import { ARTIST_NAV } from "@/lib/nav-view";

/* Artist shell: Ember, with the artist's own second row. */
export default function ArtistLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-module="artists" className="flex min-h-dvh flex-col [&>main]:flex-1">
      <SkipLink />
      <SiteHeader subnav={ARTIST_NAV} subnavLabel="Artist" />
      {children}
      <SiteFooter />
      <MobileTabBar />
    </div>
  );
}
