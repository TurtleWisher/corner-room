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
import { resolveProtectedView } from "@/lib/auth-view";
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

export const Input = DsInput;

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
  const { status, user } = useAuth();
  const pathname = usePathname();
  const view = resolveProtectedView(status, user, permission);
  if (view.kind === "loading") return <LoadingState label="Checking your session" />;
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
          It is only for Corner Room staff. Staff accounts come from an invitation; if you have one, open its link or sign in with the invited account.
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
    <main id="main" data-theme="staff" className="cr-scope min-h-[calc(100dvh-3.5rem)]">
      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-10">{children}</div>
    </main>
  );
}
