"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LogIn } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { ButtonLink, Card, Skeleton } from "@/components/ds";

function SignInGate({ what }: { what: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const here = params.toString() ? `${pathname}?${params.toString()}` : pathname;
  return (
    <Card className="max-w-xl p-6">
      <p className="text-lg font-bold text-fg">Sign in to see {what}</p>
      <ButtonLink href={`/login?next=${encodeURIComponent(here)}`} className="mt-4">
        <LogIn aria-hidden="true" /> Sign in
      </ButtonLink>
    </Card>
  );
}

/**
 * Rebuilt account pages: Ember with the quiet Front Door light (account.css), a plain heading,
 * and a sign-in gate instead of the legacy Protected card. The API still decides access.
 */
export function AccountPage({
  eyebrow,
  title,
  what,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  /** "your purchases": used in the sign-in prompt. */
  what: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { status } = useAuth();
  return (
    <main id="main" data-theme="ember" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="account-page-title" className="min-h-[70dvh]">
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
                <SignInGate what={what} />
              </Suspense>
            )}
          </div>
        </div>
      </LitSurface>
    </main>
  );
}
