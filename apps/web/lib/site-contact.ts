/*
 * Public contact details (owner, 2026-10-25: "make a default one for now"; OD-31). The one place to
 * change them. The address must reach a real inbox: forward it with Cloudflare Email Routing
 * (owner's plan, D-OPS-01) before launch, or replace it here.
 */
export const SUPPORT_EMAIL = "support@cornerroom.live";

export function supportMailto(subject?: string): string {
  return subject ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` : `mailto:${SUPPORT_EMAIL}`;
}

/** The legal pages, in footer order. */
export const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
] as const;
