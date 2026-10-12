import * as React from "react";

import { cn } from "@/lib/utils";

export const controlClasses = cn(
  "w-full bg-surface-sunken text-fg font-ui text-sm",
  "border border-line-strong px-3.5 transition-colors duration-[var(--cr-dur-interaction)]",
  "placeholder:text-fg-muted/70 hover:border-fg-muted",
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus focus-visible:border-focus",
  "aria-[invalid=true]:border-danger",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, type = "text", ...props },
  ref,
) {
  return <input ref={ref} type={type} className={cn(controlClasses, "h-11", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(controlClasses, "py-2.5 leading-relaxed", className)} {...props} />;
  },
);

/** Native select: keyboard, screen reader and mobile pickers work for free. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(controlClasses, "h-11 appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
      >
        <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    </div>
  );
});
