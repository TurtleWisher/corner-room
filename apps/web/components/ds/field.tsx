import * as React from "react";

import { cn } from "@/lib/utils";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

export interface FieldProps {
  label: React.ReactNode;
  /** Help text shown under the control. */
  hint?: React.ReactNode;
  /** Error text. When set, the control is marked invalid and the message is announced. */
  error?: React.ReactNode;
  required?: boolean;
  /** Visually hide the label (it stays available to assistive technology). */
  hideLabel?: boolean;
  className?: string;
  id?: string;
  children: (control: FieldControlProps) => React.ReactNode;
}

/** Label, help and error wiring for any control. */
export function Field({ label, hint, error, required, hideLabel, className, id, children }: FieldProps) {
  const auto = React.useId();
  const controlId = id ?? `f${auto.replace(/:/g, "")}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={controlId} className={cn("font-ui text-[0.8125rem] font-semibold text-fg", hideLabel && "sr-only")}>
        {label}
        {required ? (
          <span className="text-fg-muted">
            {" "}
            <span aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </span>
        ) : null}
      </label>
      {children({
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-xs font-medium text-danger" role="alert">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-px size-3.5 shrink-0">
            <path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 6v3.5M8 11.2v.6" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          {error}
        </p>
      ) : null}
    </div>
  );
}
