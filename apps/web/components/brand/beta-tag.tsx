import { cn } from "@/lib/utils";

/**
 * "Beta" beside the logo in every header while this is the first launched version (owner,
 * 2026-10-25). Plain small text next to the official logo file, never drawn into it. It sits
 * outside the logo's home link so the link keeps its name.
 */
export function BetaTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 text-[0.625rem] font-semibold uppercase leading-none tracking-[0.14em] text-fg-muted",
        className,
      )}
    >
      Beta
    </span>
  );
}
