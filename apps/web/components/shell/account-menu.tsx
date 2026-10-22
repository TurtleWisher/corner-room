"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, LogIn, LogOut, ShieldCheck } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { ButtonLink } from "@/components/ds";
import { Drawer } from "@/components/ds/dialog";
import { NavIcon } from "@/components/shell/nav-icons";
import { useWorkspace } from "@/components/workspace-provider";
import { activeHref, initials, menuSections, navFlagsFor, showStaffEntry, showStaffSignInLink, staffHomeHref } from "@/lib/nav-view";
import { cn } from "@/lib/utils";

/** The red initials square that opens the account menu. */
export function AvatarButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const { user } = useAuth();
  const name = user?.display_name || user?.email || "your account";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`Open menu for ${name}`}
      className={cn(
        "cr-focus inline-flex size-10 items-center justify-center bg-cr-signal font-ui text-[0.8125rem] font-extrabold tracking-wide text-cr-lamp",
        className,
      )}
    >
      {initials(user?.display_name, user?.email)}
    </button>
  );
}

/**
 * Full menu drawer: the signed-in account menu (name, email, Discover, Listen, You, staff console,
 * sign out) and, for guests, the phone menu with sign-in actions.
 */
export function AccountMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status, user, logout } = useAuth();
  const { organizations } = useWorkspace();
  const pathname = usePathname();
  const signedIn = status === "authenticated" && !!user;
  const sections = menuSections(signedIn, navFlagsFor(user));
  const active = activeHref(pathname, sections.flatMap((s) => s.items));
  const title = signedIn ? user.display_name || user.email || "Your account" : "Menu";

  return (
    <Drawer open={open} onClose={onClose} title={title} description={signedIn && user.display_name ? (user.email ?? undefined) : undefined} side="right">
      <nav aria-label="Menu" onClick={(e) => (e.target as HTMLElement).closest("a") && onClose()}>
        {signedIn && showStaffEntry(user.permissions, organizations.length) ? (
          <ButtonLink href={staffHomeHref(user.permissions)} variant="secondary" size="sm" block className="mb-5 justify-start">
            <LayoutGrid aria-hidden="true" /> Staff console
          </ButtonLink>
        ) : null}
        {sections.map((section) => (
          <div key={section.label} className="mb-5">
            <p className="cr-eyebrow mb-1 text-[0.6875rem] text-fg-muted">{section.label}</p>
            <ul>
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={item.href === active ? "page" : undefined}
                    className={cn(
                      "cr-focus flex h-11 items-center gap-3 text-[0.9375rem] font-semibold",
                      item.href === active ? "text-highlight" : "text-fg hover:text-highlight",
                    )}
                  >
                    <NavIcon href={item.href} />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            {/* Small, under "Apply as an artist": staff sign in on their own page (owner, 2026-10-23). */}
            {section.label === "Artist" && signedIn && showStaffSignInLink(signedIn, user.permissions, organizations.length) ? (
              <Link href="/staff/sign-in" className="cr-focus mt-1 inline-flex h-9 items-center gap-2 text-xs font-semibold text-fg-muted hover:text-fg">
                <ShieldCheck aria-hidden="true" className="size-3.5" /> Staff only
              </Link>
            ) : null}
          </div>
        ))}
      </nav>
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {signedIn ? (
          <button
            type="button"
            className="cr-focus inline-flex h-10 items-center gap-2 text-sm font-semibold text-fg hover:text-highlight"
            onClick={() => void logout().then(onClose)}
          >
            <LogOut aria-hidden="true" className="size-4" /> Sign out
          </button>
        ) : (
          <>
            <ButtonLink href="/login" size="sm" onClick={onClose}>
              <LogIn aria-hidden="true" /> Sign in
            </ButtonLink>
            <ButtonLink href="/register" variant="secondary" size="sm" onClick={onClose}>
              Create an account
            </ButtonLink>
          </>
        )}
      </div>
    </Drawer>
  );
}
