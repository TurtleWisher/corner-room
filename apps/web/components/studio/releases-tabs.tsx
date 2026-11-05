"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/studio/releases", label: "All releases" },
  { href: "/studio/releases/presales", label: "Pre-sales" },
];

/** The Releases area's two lists (owner, 2026-11-06, D-PRESALE-04). */
export function ReleasesTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Releases" className="mb-8 flex gap-1 border-b border-line">
      {TABS.map((t) => {
        const current = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "cr-focus -mb-px border-b-2 px-4 py-2.5 text-sm font-semibold",
              current ? "border-highlight text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
