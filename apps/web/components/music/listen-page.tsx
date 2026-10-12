"use client";

import { usePathname } from "next/navigation";
import { LogIn } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { ButtonLink, Card, Skeleton } from "@/components/ds";
import { PageIntro } from "@/components/shell/staff-panel";

/** Sky page frame for the listening room, with a sign-in gate for personal pages. */
export function ListenPage({
  eyebrow = "Listening room",
  title,
  lede,
  what,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  /** Set for personal pages ("your library"): guests are asked to sign in. */
  what?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { status } = useAuth();
  const pathname = usePathname();
  const gated = Boolean(what) && status !== "authenticated";
  return (
    <main id="main" data-theme="sky" className="cr-scope">
      <LitSurface as="section" theme="sky" aria-labelledby="listen-page-title">
        <div className="mx-auto max-w-[90rem] px-4 pb-10 pt-12 md:px-6 md:pt-16">
          <div id="listen-page-title">
            <PageIntro eyebrow={eyebrow} title={title} lede={lede}>
              {status === "authenticated" ? actions : null}
            </PageIntro>
          </div>
        </div>
      </LitSurface>
      <div className="mx-auto max-w-[90rem] space-y-12 px-4 pb-16 md:px-6">
        {gated && status === "loading" ? (
          <Skeleton className="h-40 w-full" />
        ) : gated ? (
          <Card className="max-w-xl p-6">
            <p className="text-lg font-bold text-fg">Sign in to see {what}</p>
            <ButtonLink href={`/login?next=${encodeURIComponent(pathname ?? "/listen")}`} className="mt-4">
              <LogIn aria-hidden="true" /> Sign in
            </ButtonLink>
          </Card>
        ) : (
          children
        )}
      </div>
    </main>
  );
}
