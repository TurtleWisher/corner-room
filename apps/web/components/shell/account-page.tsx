"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LogIn } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { ButtonLink, Card, Skeleton } from "@/components/ds";
import { withNext } from "@/lib/auth-view";

/** Who a page is for: fans sign in or join on the main pages, artists on the artist page. */
export type PageAudience = "fan" | "artist";

function SignInGate({ what, audience }: { what: string; audience: PageAudience }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const here = params.toString() ? `${pathname}?${params.toString()}` : pathname;
  return (
    <Card className="max-w-xl p-6">
      <p className="text-lg font-bold text-fg">Sign in to see {what}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <ButtonLink href={withNext(audience === "artist" ? "/studio/sign-in" : "/login", here)}>
          <LogIn aria-hidden="true" /> Sign in
        </ButtonLink>
        {audience === "fan" ? (
          // New here: the account is made, verified, then signed in, and they come back to this page.
          <ButtonLink href={withNext("/register", here)} variant="secondary">
            Create an account
          </ButtonLink>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Rebuilt account pages: Ember with the quiet Front Door light (account.css), or the Artist Studio
 * world for artists, a plain heading, and a sign-in gate instead of the legacy Protected card. The
 * API still decides access.
 */
export function AccountPage({
  eyebrow,
  title,
  what,
  actions,
  audience = "fan",
  children,
}: {
  eyebrow?: string;
  title: string;
  /** "your purchases": used in the sign-in prompt. */
  what: string;
  actions?: React.ReactNode;
  /** Artist pages send signed-out visitors to artist sign-in (artists join by their label's link). */
  audience?: PageAudience;
  children: React.ReactNode;
}) {
  const { status } = useAuth();
  // Artist pages sit in the Artist Studio's mint world (D-THEME-02); fan pages stay Ember.
  const world = audience === "artist" ? "artist-studio" : "ember";
  return (
    <main id="main" data-theme={world} className="cr-scope">
      <LitSurface as="section" theme={world} aria-labelledby="account-page-title" className="min-h-[70dvh]">
        <div className="mx-auto max-w-[72rem] px-4 py-12 md:px-6 md:py-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              {eyebrow ? <p className="cr-eyebrow text-highlight">{eyebrow}</p> : null}
              <h1 id="account-page-title" className="mt-3 text-3xl font-bold text-fg md:text-4xl">
                {title}
              </h1>
            </div>
            {status === "authenticated" ? actions : null}
          </div>
          <div className="mt-8">
            {status === "loading" ? (
              <Skeleton className="h-48 w-full" />
            ) : status === "authenticated" ? (
              children
            ) : (
              <Suspense fallback={null}>
                <SignInGate what={what} audience={audience} />
              </Suspense>
            )}
          </div>
        </div>
      </LitSurface>
    </main>
  );
}
