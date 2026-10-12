import { LitSurface } from "@/components/brand/corner-light";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ds";
import { TAGLINE, TAGLINE_BN } from "@/components/shell/site-footer";

/**
 * Sign-in and registration frame (account.md composition 1): one card on the lit corner, the
 * logo above, the provisional tagline beneath. Full width on phones.
 */
export function AuthCard({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main id="main" data-theme="ember" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="auth-title" className="min-h-[80dvh]">
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-12 md:py-20">
          <Logo height={72} alt="Corner Room" />
          <Card className="mt-8 w-full p-6 md:p-8">
            <h1 id="auth-title" className="text-2xl font-bold text-fg">
              {title}
            </h1>
            <div className="mt-6">{children}</div>
          </Card>
          {footer ? <div className="mt-6 text-sm text-fg">{footer}</div> : null}
          <p className="mt-10 text-center text-sm text-fg-muted">{TAGLINE}</p>
          <p lang="bn" className="mt-1 text-center font-bangla text-sm leading-[1.6] text-fg-muted">
            {TAGLINE_BN}
          </p>
        </div>
      </LitSurface>
    </main>
  );
}
