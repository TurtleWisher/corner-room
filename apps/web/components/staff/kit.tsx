"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { LogIn } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import {
  ButtonLink,
  Card as DsCard,
  EmptyState as DsEmptyState,
  ErrorState as DsErrorState,
  Input as DsInput,
  Skeleton,
  buttonVariants,
  controlClasses,
} from "@/components/ds";
import { claimStaffInvite } from "@/features/staff-portal/api";
import { resolveProtectedView } from "@/lib/auth-view";
import { choiceLabel, choicesFrom, fieldWords } from "@/lib/staff-console-view";
import { cn } from "@/lib/utils";

/*
 * Staff console building blocks with the same props as the legacy components/ui and
 * async-state primitives, drawn in the Staff (graphite) world. Pages keep their logic unchanged;
 * only the look moves to the design system. Retire per page as staff modules are redesigned.
 */

const VARIANT = { default: "primary", outline: "secondary", ghost: "ghost" } as const;
const SIZE = { default: "md", sm: "sm" } as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
}

/** Same behaviour as the legacy Button: no default `type`, so it still submits inside a form. */
export function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant: VARIANT[variant], size: SIZE[size] }), className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <DsCard className={cn("space-y-0", className)} {...props} />;
}

/**
 * The staff text field. A field that a page named only with grey placeholder text gets a real,
 * visible label from those words (owner, 2026-11-15); a placeholder that lists codes
 * ("ARTIST | RELEASE | EVENT") becomes a list to pick from. Pages keep their props and their logic.
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function StaffInput(
  { placeholder, className, id, ...props },
  ref,
) {
  const auto = React.useId();
  const labelled = Boolean(props["aria-label"] || props["aria-labelledby"]);
  const words = labelled ? null : fieldWords(placeholder);
  const choices = choicesFrom(placeholder);
  if (choices) {
    const controlId = id ?? auto;
    const value = typeof props.value === "string" ? props.value : "";
    return (
      <div className={cn("st-field", className)}>
        <label htmlFor={controlId} className="st-label">
          {props["aria-label"] ?? "Choose one"}
        </label>
        <select
          id={controlId}
          className={cn(controlClasses, "st-control")}
          value={value}
          required={props.required}
          disabled={props.disabled}
          onChange={(e) => props.onChange?.(e as unknown as React.ChangeEvent<HTMLInputElement>)}
        >
          <option value="">Choose…</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {choiceLabel(c)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (!words) return <DsInput ref={ref} id={id} placeholder={placeholder} className={className} {...props} />;
  const controlId = id ?? auto;
  return (
    <div className={cn("st-field", className)}>
      <label htmlFor={controlId} className="st-label">
        {words.label}
        {props.required ? <span aria-hidden="true" className="text-danger"> *</span> : null}
      </label>
      <DsInput ref={ref} id={controlId} aria-describedby={words.hint ? `${controlId}-hint` : undefined} {...props} />
      {words.hint ? (
        <p id={`${controlId}-hint`} className="st-hint">
          {words.hint}
        </p>
      ) : null}
    </div>
  );
});

/** Class string for native selects in staff forms. */
export const selectClasses = cn(controlClasses, "h-11");

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message }: { title?: string; message: string }) {
  return <DsErrorState title={title} message={message} />;
}

export function EmptyState({ message }: { message: string }) {
  return <DsEmptyState title={message} />;
}

/** Same contract as components/protected: sign-in and permission gates, UX only. */
export function Protected({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { status, user, refreshUser } = useAuth();
  const pathname = usePathname();
  const view = resolveProtectedView(status, user, permission);
  const [claiming, setClaiming] = React.useState<"idle" | "busy" | "done">("idle");
  // D-STAFF-ACCOUNTS-01: an admin may have added this person by email. Pick the invite up now
  // (the worker would too, a little later), then read the account again with its staff access.
  const userId = user?.id;
  React.useEffect(() => {
    if (view.kind !== "not_staff" || !userId || claiming !== "idle") return;
    setClaiming("busy");
    claimStaffInvite()
      .then(async (res) => {
        if (res.claimed) await refreshUser();
      })
      .catch(() => undefined)
      .finally(() => setClaiming("done"));
  }, [view.kind, userId, claiming, refreshUser]);
  if (view.kind === "loading" || (view.kind === "not_staff" && claiming !== "done")) return <LoadingState label="Checking your session" />;
  if (view.kind === "unauthenticated") {
    return (
      <DsCard className="max-w-xl p-6">
        <p className="text-lg font-bold text-fg">{view.reason === "expired" ? "Your session has ended" : "Sign in to continue"}</p>
        <ButtonLink href={`/staff/sign-in?next=${encodeURIComponent(pathname ?? "/staff")}`} className="mt-4">
          <LogIn aria-hidden="true" /> Sign in
        </ButtonLink>
      </DsCard>
    );
  }
  if (view.kind === "not_staff") {
    return (
      <DsCard className="max-w-xl p-6">
        <p className="text-lg font-bold text-fg">This is the staff console</p>
        <p className="mt-2 text-sm text-fg-muted">
          It is only for Corner Room staff. An admin adds staff by email: sign in with Continue with Google using the address they added, or open an invitation link if you have one.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink href={`/staff/sign-in?next=${encodeURIComponent(pathname ?? "/staff")}`} variant="secondary">
            <LogIn aria-hidden="true" /> Staff sign-in
          </ButtonLink>
          <ButtonLink href="/" variant="ghost">
            Back to Corner Room
          </ButtonLink>
        </div>
      </DsCard>
    );
  }
  if (view.kind === "forbidden") {
    return (
      <DsCard className="max-w-xl p-6">
        <p className="text-lg font-bold text-fg">You do not have access to this page</p>
        <p className="mt-2 text-sm text-fg-muted">Ask an administrator if you need it.</p>
        <Link href="/" className="cr-focus mt-4 inline-block text-sm font-semibold text-link underline">
          Back to Corner Room
        </Link>
      </DsCard>
    );
  }
  return <>{children}</>;
}

/**
 * The staff page frame: graphite surface, wide content column. Used by the staff layout so every
 * staff page shares it.
 */
export function StaffMain({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" data-theme="staff" className="cr-scope min-h-[calc(100dvh-3rem)]">
      <div className="st-page mx-auto max-w-[88rem] px-4 py-6 md:px-8 md:py-8">{children}</div>
    </main>
  );
}
