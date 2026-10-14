"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CalendarDays, Headphones, House, LogIn, Search, UserRound, type LucideIcon } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { AccountMenu } from "@/components/shell/account-menu";
import { isActivePath } from "@/lib/nav-view";
import { cn } from "@/lib/utils";

const TAB = "cr-focus flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold";

function Tab({ href, label, icon: Icon, exact }: { href: string; label: string; icon: LucideIcon; exact?: boolean }) {
  const pathname = usePathname();
  const current = exact ? pathname === href : isActivePath(pathname, href);
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={cn(TAB, current ? "text-highlight" : "text-fg-muted")}>
      <Icon className="size-5" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}

/**
 * Phone navigation (under 1024 px): Home, Events, Listen, Search, and Sign in or You (which opens
 * the account menu). Hidden from 1024 px up, where the header carries the links.
 */
export function MobileTabBar({ world = "ember" }: { world?: "ember" | "sky" }) {
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  const signedIn = status === "authenticated";
  return (
    <>
      <div data-theme={world} className="cr-scope h-16 lg:hidden" aria-hidden="true" />
      <nav
        aria-label="Main"
        data-theme={world}
        className="cr-scope cr-bar fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <Tab href="/" label="Home" icon={House} exact />
        <Tab href="/events" label="Events" icon={CalendarDays} />
        <Tab href="/listen" label="Listen" icon={Headphones} />
        <Tab href="/search" label="Search" icon={Search} />
        {signedIn ? (
          <button type="button" className={cn(TAB, "text-fg-muted")} aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <UserRound className="size-5" aria-hidden="true" />
            <span>You</span>
          </button>
        ) : (
          <Tab href="/login" label="Sign in" icon={LogIn} />
        )}
      </nav>
      <AccountMenu open={open} onClose={() => setOpen(false)} />
    </>
  );
}
