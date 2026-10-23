"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutGrid, LogIn, LogOut, ShieldCheck, UserRound, Wrench } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { ButtonLink } from "@/components/ds";
import { Drawer } from "@/components/ds/dialog";
import { NavIcon } from "@/components/shell/nav-icons";
import { useFanView } from "@/components/use-fan-view";
import { useWorkspace } from "@/components/workspace-provider";
import { coverUrl } from "@/lib/cover-view";
import { activeHref, initials, menuSections, navFlagsFor, showStaffEntry, showStaffSignInLink, staffHomeHref } from "@/lib/nav-view";
import { cn } from "@/lib/utils";

/** The red initials square that opens the account menu, or the fan's picture when they have one. */
export function AvatarButton({ onClick, className }: { onClick: () => void; className?: string }) {
  const { user } = useAuth();
  const name = user?.display_name || user?.email || "your account";
  const picture = coverUrl({ signed: user?.avatar_url });
  // The signed link lasts an hour; if it has run out, the initials come back.
  const [broken, setBroken] = useState<string | null>(null);
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
      {picture && broken !== picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed picture link from the API
        <img src={picture} alt="" className="size-full object-cover" onError={() => setBroken(picture)} />
      ) : (
        initials(user?.display_name, user?.email)
      )}
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
  const staffEntry = signedIn && showStaffEntry(user.permissions, organizations.length);
  const [fanView, setFanView] = useFanView();

  return (
    <Drawer open={open} onClose={onClose} title={title} description={signedIn && user.display_name ? (user.email ?? undefined) : undefined} side="right">
      <nav aria-label="Menu" onClick={(e) => (e.target as HTMLElement).closest("a") && onClose()}>
        {signedIn && fanView && (staffEntry || user.is_artist) ? (
          // Fan view (owner, 2026-10-24): say so, and offer the way back. Permissions are unchanged.
          <div className="mb-5 border border-line p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-fg">
              <UserRound aria-hidden="true" className="size-4 text-highlight" /> You&apos;re in fan view
            </p>
            <p className="mt-1 text-xs text-fg-muted">Staff tools are hidden on these pages, so you see them as fans do.</p>
            <div className="mt-3 grid gap-2">
              {user.is_artist ? (
                <ButtonLink href="/studio" variant="secondary" size="sm" block className="justify-start">
                  <NavIcon href="/studio" /> Back to Studio
                </ButtonLink>
              ) : null}
              {staffEntry ? (
                <ButtonLink href={staffHomeHref(user.permissions)} variant="secondary" size="sm" block className="justify-start">
                  <LayoutGrid aria-hidden="true" /> Back to staff console
                </ButtonLink>
              ) : null}
              <button
                type="button"
                className="cr-focus inline-flex h-9 items-center gap-2 text-xs font-semibold text-fg-muted hover:text-fg"
                onClick={() => setFanView(false)}
              >
                <Wrench aria-hidden="true" className="size-3.5" /> Show staff tools on these pages
              </button>
            </div>
          </div>
        ) : signedIn && staffEntry ? (
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
