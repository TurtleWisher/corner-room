import { OutsideRoom } from "@/components/music/outside-room";
import { PlayerBar, PlayerProvider } from "@/components/music/player";
import { MobileTabBar } from "@/components/shell/mobile-tab-bar";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader, SkipLink } from "@/components/shell/site-header";
import { LISTEN_NAV } from "@/lib/nav-view";

/* Listening room shell: Sky world with the persistent player, so playback survives navigation
   inside this group. The listening room itself (/listen/[trackId]) is full screen: the header,
   footer and tab bar step aside there. */
export default function ListenLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-module="music" className="flex min-h-dvh flex-col [&>main]:flex-1">
      <PlayerProvider>
      <SkipLink />
      <OutsideRoom>
        <SiteHeader world="sky" subnav={LISTEN_NAV} subnavLabel="Listening room" />
      </OutsideRoom>
      {children}
      <OutsideRoom>
        <SiteFooter world="sky" />
      </OutsideRoom>
      <PlayerBar />
      <OutsideRoom>
        <MobileTabBar world="sky" />
      </OutsideRoom>
      </PlayerProvider>
    </div>
  );
}
