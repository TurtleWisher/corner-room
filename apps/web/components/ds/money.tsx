import * as React from "react";

import { formatMoneyParts, type MoneyFormatOptions, type MoneyValue } from "@/lib/format/money";
import { cn } from "@/lib/utils";

import { UnavailableValue } from "./states";

export interface MoneyProps extends MoneyFormatOptions {
  value: MoneyValue | null | undefined;
  /** "display": condensed Archivo numerals for prices; "inline": inherits the surrounding text. */
  variant?: "display" | "inline";
  className?: string;
}

/**
 * Formats API money for display only (D-P16-03). The ৳ sign comes from a Bengali-capable face;
 * screen readers hear the ISO code ("BDT 1,500"). Missing or malformed values say "Not available".
 */
export function Money({ value, variant = "inline", className, ...options }: MoneyProps) {
  const out = formatMoneyParts(value, options);
  if (!out) return <UnavailableValue className={className} />;
  return (
    <span className={cn(variant === "display" && "cr-num", "whitespace-nowrap", className)} data-currency={out.currency}>
      <span aria-hidden="true">
        {out.parts.map((p, i) =>
          p.type === "currency" && p.value === "৳" ? (
            <span key={i} className="cr-taka">
              {p.value}
            </span>
          ) : (
            <React.Fragment key={i}>{p.value}</React.Fragment>
          ),
        )}
      </span>
      <span className="sr-only">{out.accessibleText}</span>
    </span>
  );
}
