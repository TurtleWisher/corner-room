import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Buttons have the brand's cut top-left corner. Fill and border are drawn by .cr-cut pseudo-
 * elements, so the focus outline is never clipped.
 */
export const buttonVariants = cva(
  [
    "cr-cut cr-cut-sm cr-focus inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "font-ui font-semibold tracking-[0.01em] transition-[color,opacity] duration-[var(--cr-dur-interaction)]",
    "disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "text-on-accent [--cut-fill:var(--cr-accent)] [--cut-border:var(--cr-accent)] hover:[--cut-fill:color-mix(in_srgb,var(--cr-accent)_84%,white)]",
        brand:
          "text-on-brand [--cut-fill:var(--cr-brand)] [--cut-border:var(--cr-brand)] hover:[--cut-fill:color-mix(in_srgb,var(--cr-brand)_86%,white)]",
        secondary:
          "text-fg [--cut-fill:var(--cr-surface-overlay)] [--cut-border:var(--cr-line-strong)] hover:[--cut-fill:color-mix(in_srgb,var(--cr-fg)_12%,transparent)]",
        ghost: "text-fg [--cut-fill:transparent] hover:[--cut-fill:var(--cr-surface-overlay)]",
        danger:
          "text-on-danger-fill [--cut-fill:var(--cr-danger-fill)] [--cut-border:var(--cr-danger-fill)] hover:[--cut-fill:color-mix(in_srgb,var(--cr-danger-fill)_86%,white)]",
      },
      size: {
        sm: "h-9 px-3.5 text-[0.8125rem]",
        md: "h-11 px-5 text-sm",
        lg: "h-12 px-6 text-[0.9375rem]",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps {
  /** Shows a busy state and blocks repeat submits. */
  busy?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, busy, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
});

export interface ButtonLinkProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Link>, "className">,
    ButtonVariantProps {
  className?: string;
}

/** A link that looks like a button. Use for navigation; use Button for actions. */
export function ButtonLink({ className, variant, size, block, ...props }: ButtonLinkProps) {
  return <Link className={cn(buttonVariants({ variant, size, block }), className)} {...props} />;
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="animate-spin motion-reduce:animate-none">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}
