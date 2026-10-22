"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Menu } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/brand/logo";
import { ButtonLink, Skeleton } from "@/components/ds";
import { Drawer } from "@/components/ds/dialog";
import { AccountMenu, AvatarButton } from "@/components/shell/account-menu";
import { NavIcon } from "@/components/shell/nav-icons";
import { SkipLink } from "@/components/shell/site-header";
import { ShellBell } from "@/components/shell/shell-bell";
import { useAsync } from "@/components/use-async";
import { fetchMyProfiles, type CatalogProfile } from "@/features/studio/api";
import { activeHref, isStudioAuthPath, staffBreadcrumb, studioNavSections, type NavSection } from "@/lib/nav-view";
import { cn } from "@/lib/utils";

const WORLD = "artist-studio";

/** The mint mark (D-THEME-02): the official mint colourway on its Signal Mint field, never on the dark base. */
function StudioMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/studio" className="cr-focus flex items-center gap-3" aria-label="Artist Studio home">
      <span className="cr-cut cr-cut-sm inline-flex shrink-0 p-1.5 [--cut-fill:var(--cr-brand)]">
        <Logo variant="artist-mint" height={40} alt="" />
      </span>
      {compact ? null : <span className="cr-eyebrow text-[0.6875rem] text-fg">Artist Studio</span>}
    </Link>
  );
}

/** Who this account publishes as. Real profiles from the API; nothing shown is invented. */
function PublishingAs({ profiles }: { profiles: CatalogProfile[] | null }) {
  return (
    <div className="border border-line bg-surface-sunken px-4 py-3">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-fg-muted">Publishing as</p>
      {profiles === null ? (
        <Skeleton className="mt-2 h-5 w-32" />
      ) : profiles.length === 0 ? (
        <p className="mt-1 text-sm text-fg">No artist profile yet</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {profiles.map((p) => (
            <li key={`${p.kind}-${p.id}`} className="text-sm">
              <span className="block truncate font-semibold text-fg">{p.display_name}</span>
              <span className="text-fg-muted">{p.kind === "band" ? "Band" : "Artist"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StudioNav({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isStudioAuthPath(pathname) ? null : activeHref(pathname, sections.flatMap((s) => s.items));
  return (
    <nav aria-label="Studio">
      {sections.map((section) => (
        <div key={section.label} className="mb-4">
          <p className="cr-eyebrow mb-1 px-5 text-[0.6875rem] text-fg-muted">{section.label}</p>
          <ul>
            {section.items.map((item) => {
              const current = item.href === active;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "cr-focus flex min-h-10 items-center gap-3 border-l-[3px] px-5 py-2 text-sm font-semibold",
                      current ? "border-accent bg-surface-overlay text-fg" : "border-transparent text-fg-muted hover:text-fg",
                    )}
                  >
                    <NavIcon href={item.href} />
                    <span className="min-w-0 truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function BackLink({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/" onClick={onClick} className="cr-focus flex h-11 items-center gap-2 px-5 text-sm font-semibold text-fg-muted hover:text-fg">
      <ArrowLeft aria-hidden="true" className="size-4" /> Back to Corner Room
    </Link>
  );
}

/**
 * Artist Studio shell (ARTIST_STUDIO_DESIGN_GUIDE section 6): the mint world for signed-in artists
 * and band admins. Mint mark, "Publishing as" identity, Studio sections, "Back to Corner Room".
 * Under 1024 px the side panel becomes a drawer and the header keeps the profile name visible.
 * Never reuses the public header; menus are UX only and every page still asks the API.
 */
export function StudioShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();
  const signedIn = status === "authenticated";
  const loaded = useAsync(() => (signedIn ? fetchMyProfiles() : Promise.resolve([] as CatalogProfile[])), [signedIn]);
  const profiles = loaded.status === "ok" ? loaded.data : loaded.status === "error" ? [] : null;
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sections = studioNavSections(profiles ?? []);
  const crumb = isStudioAuthPath(pathname) ? null : staffBreadcrumb(pathname, sections);
  const who = profiles && profiles.length > 0 ? profiles.map((p) => p.display_name).join(" · ") : null;

  return (
    <div data-module="artist-studio" className="lg:grid lg:min-h-dvh lg:grid-cols-[16rem_minmax(0,1fr)]">
      <SkipLink />
      <aside data-theme={WORLD} className="cr-scope hidden border-r border-line lg:block">
        <div className="sticky top-0 flex h-dvh flex-col">
          <div className="px-5 pb-4 pt-5">
            <StudioMark />
          </div>
          {signedIn ? (
            <div className="px-4 pb-5">
              <PublishingAs profiles={profiles} />
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StudioNav sections={sections} />
          </div>
          <div className="border-t border-line py-2">
            <BackLink />
          </div>
        </div>
      </aside>
      <div className="flex min-h-dvh min-w-0 flex-col [&>main]:flex-1">
        <header data-theme={WORLD} className="cr-scope cr-bar sticky top-0 z-30 border-b border-line">
          <div className="flex h-16 items-center gap-3 px-3 md:px-6">
            <button
              type="button"
              aria-label="Studio menu"
              aria-haspopup="dialog"
              className="cr-focus inline-flex size-10 shrink-0 items-center justify-center text-fg lg:hidden"
              onClick={() => setNavOpen(true)}
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <div className="lg:hidden">
              <StudioMark compact />
            </div>
            {/* Phones keep the workspace identity in view (guide section 6). */}
            {who ? <p className="min-w-0 truncate text-sm font-semibold text-fg lg:hidden">{who}</p> : null}
            {crumb ? (
              <p className="hidden text-sm text-fg-muted lg:block">
                {crumb[0]} / <span className="font-semibold text-fg">{crumb[1]}</span>
              </p>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {signedIn ? (
                <>
                  <ShellBell />
                  <AvatarButton onClick={() => setMenuOpen(true)} className="ml-1 bg-brand text-on-brand" />
                </>
              ) : status === "loading" ? null : (
                <ButtonLink href="/studio/sign-in" size="sm">
                  Sign in
                </ButtonLink>
              )}
            </div>
          </div>
        </header>
        {children}
      </div>
      {/* Dialogs render in place and take their colours from here. Not on the root: a world nested
          in itself switches off its page light (tokens.css). */}
      <div data-theme={WORLD} className="contents">
        <Drawer open={navOpen} onClose={() => setNavOpen(false)} title="Artist Studio" side="right">
          <div className="-mx-5">
            {signedIn ? (
              <div className="px-5 pb-5">
                <PublishingAs profiles={profiles} />
              </div>
            ) : null}
            <StudioNav sections={sections} onNavigate={() => setNavOpen(false)} />
            <div className="border-t border-line pt-2">
              <BackLink onClick={() => setNavOpen(false)} />
            </div>
          </div>
        </Drawer>
        <AccountMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      </div>
    </div>
  );
}
