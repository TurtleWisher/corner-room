"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeHref, type NavItem } from "@/lib/nav-view";
import { cn } from "@/lib/utils";

/** A row of links with one active item (aria-current="page" plus a Lamp underline, never colour alone). */
export function NavLinks({
  items,
  label,
  className,
  linkClassName,
}: {
  items: NavItem[];
  label: string;
  className?: string;
  linkClassName?: string;
}) {
  const pathname = usePathname();
  const active = activeHref(pathname, items);
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const current = item.href === active;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "cr-focus relative inline-flex h-10 items-center px-3 text-sm font-semibold transition-colors duration-[var(--cr-dur-interaction)]",
                  current ? "text-fg" : "text-fg-muted hover:text-fg",
                  linkClassName,
                )}
              >
                {item.label}
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-3 bottom-1 h-0.5 bg-highlight transition-opacity duration-[var(--cr-dur-interaction)]",
                    current ? "opacity-100" : "opacity-0",
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
