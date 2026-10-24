"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { Logo } from "@/components/brand/logo";
import { Reveal } from "@/components/ds/reveal";
import { LEGAL_LINKS, SUPPORT_EMAIL, supportMailto } from "@/lib/site-contact";

/* Provisional tagline (D-P16-07, launch blocker LB-02). Replace both lines together with the home hero. */
export const TAGLINE = "The city's corner. The music's room.";
export const TAGLINE_BN = "শহরের কোণে, গানের ঘরে";

type FooterLink = { href: string; label: string };

/**
 * Site footer for the public, listening, account and artist shells. A low corner light rises
 * behind the logo as the closing note (static; it only fades in once, and not under reduced
 * motion). Contact: the default support address and the legal pages (owner, 2026-10-25).
 */
export function SiteFooter({ world = "ember" }: { world?: "ember" | "sky" }) {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: "Explore",
      links: [
        { href: "/events", label: "Events" },
        { href: "/artists", label: "Artists" },
        { href: "/search", label: "Search" },
      ],
    },
    {
      title: "Listen and shop",
      links: [
        { href: "/listen", label: "Listen" },
        { href: "/releases", label: "Releases" },
        { href: "/store", label: "Store" },
      ],
    },
    {
      title: "You",
      links: signedIn
        ? [
            { href: "/account", label: "Account" },
            { href: "/tickets", label: "Tickets" },
            { href: "/orders", label: "Orders" },
          ]
        : [
            { href: "/login", label: "Sign in" },
            { href: "/register", label: "Create an account" },
          ],
    },
  ];

  return (
    <footer data-theme={world} className="cr-scope relative overflow-hidden border-t border-line">
      {/* The closing light: a low pool from the bottom-left corner, under the logo. */}
      <Reveal aria-hidden="true" className="cr-footer-light pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-[90rem] gap-10 px-4 py-12 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_minmax(0,1.2fr)] md:px-6 md:py-14">
        <div>
          <Logo variant={world === "sky" ? "indigo" : "ember"} height={56} alt="Corner Room" />
          <p className="mt-5 text-sm font-semibold text-fg">{TAGLINE}</p>
          <p lang="bn" className="mt-1 font-bangla text-sm leading-[1.6] text-fg-muted">
            {TAGLINE_BN}
          </p>
        </div>
        {columns.map((col) => (
          <nav key={col.title} aria-label={`Footer: ${col.title}`}>
            <p className="cr-eyebrow text-fg-muted">{col.title}</p>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="cr-focus text-sm text-fg hover:text-highlight">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        <div>
          <p className="cr-eyebrow text-fg-muted">Contact</p>
          {/* Default contact (owner, 2026-10-25; OD-31): lib/site-contact.ts. No phone, address or
              social accounts until the owner gives real ones. */}
          <a href={supportMailto()} className="cr-focus mt-4 inline-block text-sm text-fg hover:text-highlight">
            {SUPPORT_EMAIL}
          </a>
          <nav aria-label="Footer: Legal" className="mt-5">
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="cr-focus text-sm text-fg-muted hover:text-highlight">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  );
}
