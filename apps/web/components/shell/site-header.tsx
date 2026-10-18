"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, Search } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ds";
import { AccountMenu, AvatarButton } from "@/components/shell/account-menu";
import { NavLinks } from "@/components/shell/nav-link";
import { NavIcon } from "@/components/shell/nav-icons";
import { ShellBell } from "@/components/shell/shell-bell";
import { PUBLIC_NAV, SEARCH_HREF, activeHref, filterNavForUser, navFlagsFor, type NavItem } from "@/lib/nav-view";
import { cn } from "@/lib/utils";

export type ShellWorld = "ember" | "sky";

/** Skip link: the first focusable element on every page. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="cr-focus sr-only z-50 bg-accent px-4 py-2 font-semibold text-on-accent focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
    >
      Skip to content
    </a>
  );
}

const ICON_LINK = "cr-focus inline-flex size-10 items-center justify-center text-fg hover:text-highlight";

/** A section's own row: icon plus label, the current page boxed (account.md, the old design). */
export function SectionNav({ items, label }: { items: NavItem[]; label: string }) {
  const pathname = usePathname();
  const active = activeHref(pathname, items);
  return (
    <nav aria-label={label} className="border-t border-line">
      <ul className="mx-auto flex max-w-[90rem] items-center gap-1 overflow-x-auto px-4 py-2 md:px-6">
        {items.map((item) => {
          const current = item.href === active;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "cr-focus inline-flex h-9 items-center gap-2 border px-3 text-[0.8125rem] font-semibold",
                  current ? "border-line-strong bg-surface-overlay text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                <NavIcon href={item.href} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Header for the public, listening, account and artist shells (Ember, or Sky in the listening
 * room). Desktop: logo, main links, search, then Sign in and Join, or bell and the initials menu.
 * Phones: logo, search, and the bell plus initials or the menu button; main links move to the tab bar.
 */
export function SiteHeader({
  world = "ember",
  subnav,
  subnavLabel,
  subnavAuthOnly = false,
}: {
  world?: ShellWorld;
  subnav?: NavItem[];
  subnavLabel?: string;
  /** Show the second row only to signed-in users (account pages also host sign-in and registration). */
  subnavAuthOnly?: boolean;
}) {
  const { status, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const signedIn = status === "authenticated";
  // Fans do not see artist-only or staff-only places (owner, 2026-10-17).
  const items = subnav ? filterNavForUser(subnav, navFlagsFor(signedIn ? user : null)) : [];
  const showSubnav = items.length > 0 && (!subnavAuthOnly || signedIn);

  return (
    <header data-theme={world} className="cr-scope cr-bar sticky top-0 z-30 border-b border-line">
      <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-6 px-4 md:px-6">
        <Link href="/" className="cr-focus shrink-0" aria-label="Corner Room home">
          <Logo variant={world === "sky" ? "indigo" : "ember"} height={40} alt="" />
        </Link>
        <NavLinks items={PUBLIC_NAV} label="Main" className="hidden min-w-0 flex-1 lg:block" />
        <div className="ml-auto flex items-center gap-1">
          <Link href={SEARCH_HREF} aria-label="Search" title="Search" className={ICON_LINK}>
            <Search className="size-5" aria-hidden="true" />
          </Link>
          {status === "loading" ? (
            <span className="h-10 w-10" aria-hidden="true" />
          ) : signedIn ? (
            <>
              <ShellBell />
              <AvatarButton onClick={() => setMenuOpen(true)} className="ml-1" />
            </>
          ) : (
            <>
              <Link href="/login" className="cr-focus hidden h-10 items-center px-3 text-sm font-semibold text-fg hover:text-highlight lg:inline-flex">
                Sign in
              </Link>
              <ButtonLink href="/register" size="sm" className="hidden lg:inline-flex">
                Join
              </ButtonLink>
              <button type="button" aria-label="Menu" aria-haspopup="dialog" className={cn(ICON_LINK, "lg:hidden")} onClick={() => setMenuOpen(true)}>
                <Menu className="size-5" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>
      {showSubnav ? <SectionNav items={items} label={subnavLabel ?? "Section"} /> : null}
      <AccountMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </header>
  );
}
