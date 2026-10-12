import * as React from "react";

import { cn } from "@/lib/utils";

/** Scrollable, labelled table region. Numeric columns align right with tabular figures. */
export function Table({
  label,
  className,
  children,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { label: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="cr-focus w-full overflow-x-auto">
      <table className={cn("w-full border-collapse font-ui text-sm", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-line last:border-b-0", className)} {...props} />;
}

type Align = { numeric?: boolean };

export function TH({ className, numeric, scope = "col", ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & Align) {
  return (
    <th
      scope={scope}
      className={cn(
        "cr-eyebrow h-10 border-b border-line-strong px-3 text-left align-bottom text-[0.625rem] text-fg-muted",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, numeric, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & Align) {
  return (
    <td
      className={cn("h-11 px-3 align-middle text-fg", numeric && "text-right tabular-nums", className)}
      {...props}
    />
  );
}
