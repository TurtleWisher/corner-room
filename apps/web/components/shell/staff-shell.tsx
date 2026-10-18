"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Menu } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ds";
import { Drawer } from "@/components/ds/dialog";
import { AccountMenu, AvatarButton } from "@/components/shell/account-menu";
import { NavIcon } from "@/components/shell/nav-icons";
import { SkipLink } from "@/components/shell/site-header";
import { ShellBell } from "@/components/shell/shell-bell";
import { WorkspaceChip, WorkspacePrompt } from "@/components/shell/workspace-chip";
import { activeHref, staffBreadcrumb, staffNavSections, type NavSection } from "@/lib/nav-view";
import { cn } from "@/lib/utils";

function StaffNav({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = activeHref(pathname, sections.flatMap((s) => s.items));
  return (
    <nav aria-label="Staff">
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
                      "cr-focus flex h-10 items-center gap-3 border-l-[3px] px-5 text-sm font-semibold",
                      current ? "border-highlight bg-surface-overlay text-fg" : "border-transparent text-fg-muted hover:text-fg",
                    )}
                  >
                    <NavIcon href={item.href} />
                    {item.label}
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

function ConsoleMark() {
  return (
    <Link href="/" className="cr-focus flex items-center gap-3" aria-label="Corner Room home">
      <Logo variant="ember" height={40} alt="" />
      <span className="cr-eyebrow text-[0.6875rem] text-fg">Staff console</span>
    </Link>
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
 * Staff console (graphite world): logo and console label, the "Acting in" workspace chip, grouped
 * navigation with icons, and "Back to Corner Room". Under 1024 px the side panel becomes a drawer.
 * Never reuses the public header.
 */
export function StaffShell({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const sections = staffNavSections(user?.permissions);
  const crumb = staffBreadcrumb(pathname, sections);

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[16rem_minmax(0,1fr)]">
      <SkipLink />
      <aside data-theme="staff" className="cr-scope hidden border-r border-line lg:block">
        <div className="sticky top-0 flex h-dvh flex-col">
          <div className="px-5 pb-4 pt-5">
            <ConsoleMark />
          </div>
          <div className="px-4 pb-5">
            <WorkspaceChip />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StaffNav sections={sections} />
          </div>
          <div className="border-t border-line py-2">
            <BackLink />
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header data-theme="staff" className="cr-scope cr-bar sticky top-0 z-30 border-b border-line">
          <div className="flex h-14 items-center gap-3 px-3 md:px-6">
            <button
              type="button"
              aria-label="Staff menu"
              aria-haspopup="dialog"
              className="cr-focus inline-flex size-10 items-center justify-center text-fg lg:hidden"
              onClick={() => setNavOpen(true)}
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <Link href="/" className="cr-focus lg:hidden" aria-label="Corner Room home">
              <Logo variant="ember" height={40} alt="" />
            </Link>
            {crumb ? (
              <p className="hidden text-sm text-fg-muted lg:block">
                {crumb[0]} / <span className="font-semibold text-fg">{crumb[1]}</span>
              </p>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              {status === "authenticated" ? (
                <>
                  <ShellBell />
                  <AvatarButton onClick={() => setMenuOpen(true)} className="ml-1" />
                </>
              ) : status === "loading" ? null : (
                <ButtonLink href="/staff/sign-in" size="sm">
                  Sign in
                </ButtonLink>
              )}
            </div>
          </div>
        </header>
        <WorkspacePrompt />
        {children}
      </div>
      <Drawer open={navOpen} onClose={() => setNavOpen(false)} title="Staff console" side="right">
        <div className="-mx-5">
          <div className="px-5 pb-5">
            <WorkspaceChip />
          </div>
          <StaffNav sections={sections} onNavigate={() => setNavOpen(false)} />
          <div className="border-t border-line pt-2">
            <BackLink onClick={() => setNavOpen(false)} />
          </div>
        </div>
      </Drawer>
      <AccountMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
