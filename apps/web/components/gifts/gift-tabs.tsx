/* Studio > Gifts (owner, 2026-11-02, D-MAIL-01; 2026-11-06, D-GIFT-MUSIC-01): gift campaigns for
 * buyers, music given free to chosen people, and emails to buyers. */

import Link from "next/link";

const TABS = [
  { key: "campaigns", href: "/studio/gifts", label: "Gift campaigns" },
  { key: "music", href: "/studio/gifts/music", label: "Music gifts" },
  // The Mailbox holds every email now (owner, 2026-11-09, D-MAILBOX-01).
  { key: "emails", href: "/studio/mailbox", label: "Emails" },
] as const;

export function GiftTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    <nav aria-label="Gifts" className="mb-8 flex gap-1 border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`cr-focus -mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
            t.key === current ? "border-highlight text-fg" : "border-transparent text-fg-muted hover:text-fg"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
