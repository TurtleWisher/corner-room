import { PlayerBar, PlayerProvider } from "@/components/music/player";
import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader, SkipLink } from "@/components/shell/site-header";
import { LISTEN_NAV } from "@/lib/nav-view";

/* Listening room shell: Sky world with the persistent player, so playback survives navigation
   inside this group. */
export default function ListenLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-module="music" className="flex min-h-dvh flex-col [&>main]:flex-1">
      <PlayerProvider>
      <SkipLink />
      <SiteHeader world="sky" subnav={LISTEN_NAV} subnavLabel="Listening room" />
      {children}
      <SiteFooter world="sky" />
      <PlayerBar />
      <MobileTabBar world="sky" />
      </PlayerProvider>
    </div>
  );
}
