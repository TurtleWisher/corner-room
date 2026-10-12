"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/brand/logo";

/* Provisional tagline (D-P16-07, launch blocker LB-02). Replace both lines together with the home hero. */
export const TAGLINE = "The city's corner. The music's room.";
export const TAGLINE_BN = "শহরের কোণে, গানের ঘরে";

/** Site footer for the public, listening, account and artist shells. */
export function SiteFooter({ world = "ember" }: { world?: "ember" | "sky" }) {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  const links = [
    { href: "/discover", label: "Events" },
    { href: "/listen", label: "Listen" },
    { href: "/artists", label: "Artists" },
    { href: "/store", label: "Store" },
    { href: "/search", label: "Search" },
    signedIn ? { href: "/account", label: "Account" } : { href: "/login", label: "Sign in" },
  ];
  return (
    <footer data-theme={world} className="cr-scope border-t border-line">
      <div className="mx-auto flex max-w-[90rem] flex-col gap-8 px-4 py-10 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-center gap-4">
          <Logo variant={world === "sky" ? "indigo" : "ember"} height={52} alt="Corner Room" />
          <div>
            <p className="text-sm font-semibold text-fg">{TAGLINE}</p>
            <p lang="bn" className="mt-1 font-bangla text-sm leading-[1.6] text-fg-muted">
              {TAGLINE_BN}
            </p>
          </div>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="cr-focus text-sm text-fg-muted hover:text-fg">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
