"use client";

import { useEffect, useState } from "react";

import { fetchAuthProviders, googleSignInUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/*
 * "Continue with Google", the one phrase used everywhere. Drawn to Google's sign-in branding
 * rules (dark theme: #131314 fill, #8E918F border, #E3E3E3 text, the unmodified four-colour G),
 * so its colours are Google's, not Corner Room tokens. It is a plain link: the API runs the
 * whole Google exchange, so no Google script, popup or token ever touches this page.
 */

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5 shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="size-5 shrink-0 animate-spin rounded-full border-2 border-[#8E918F] border-t-[#E3E3E3]" />;
}

/** Shown only when the API reports Google sign-in is configured. */
export function useGoogleSignInAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAuthProviders()
      .then((providers) => !cancelled && setAvailable(providers.google === true))
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

export function GoogleButton({ next, className }: { next?: string | null; className?: string }) {
  const [busy, setBusy] = useState(false);

  // Coming back with the browser's Back button restores the page from cache: clear the busy state.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => event.persisted && setBusy(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <a
      href={googleSignInUrl(next)}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (busy) {
          event.preventDefault(); // one sign-in at a time
          return;
        }
        setBusy(true);
      }}
      className={cn(
        "cr-focus flex h-11 w-full items-center justify-center gap-3 border border-[#8E918F] bg-[#131314] px-4",
        "font-ui text-sm font-medium text-[#E3E3E3] transition-colors hover:bg-[#1F1F21] active:bg-[#2A2A2D]",
        busy && "pointer-events-none cursor-progress opacity-80",
        className,
      )}
    >
      {busy ? <Spinner /> : <GoogleMark />}
      <span>{busy ? "Opening Google…" : "Continue with Google"}</span>
    </a>
  );
}

/** The Google button plus the "or" rule above an email form. Renders nothing when switched off. */
export function GoogleSignInOption({ next }: { next?: string | null }) {
  const available = useGoogleSignInAvailable();
  if (!available) return null;
  return (
    <div className="mb-6">
      <GoogleButton next={next} />
      {/* Decorative: screen readers go straight from the Google link to the labelled email form. */}
      <div aria-hidden="true" data-testid="auth-or" className="mt-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        <span className="h-px flex-1 bg-line" />
        <span>or</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
