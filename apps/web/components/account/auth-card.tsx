import { LitSurface } from "@/components/brand/corner-light";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ds";
import { TAGLINE, TAGLINE_BN } from "@/components/shell/site-footer";

/**
 * Sign-in and registration frame (account.md composition 1): one card on the lit corner, the
 * logo above, the provisional tagline beneath. Full width on phones.
 */
/** Worlds an auth page can take: Ember for fans, staff (black, D-THEME-01), Artist Studio (mint, D-THEME-02). */
export type AuthWorld = "ember" | "staff" | "artist-studio";

/** `theme`: Ember for fans; "staff" for the staff sign-in and join pages; "artist-studio" for Studio's. */
export function AuthCard({
  title,
  children,
  footer,
  theme = "ember",
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  theme?: AuthWorld;
}) {
  return (
    <main id="main" data-theme={theme} className="cr-scope">
      <LitSurface as="section" theme={theme} aria-labelledby="auth-title" className="min-h-[80dvh]">
        <div className="mx-auto flex max-w-md flex-col items-center px-4 py-12 md:py-20">
          {theme === "artist-studio" ? (
            // The mint colourway only ever sits on its Signal Mint field (D-THEME-02).
            <span className="cr-cut inline-flex px-6 py-4 [--cut-fill:var(--cr-brand)]">
              <Logo variant="artist-mint" height={72} alt="Corner Room Artist Studio" />
            </span>
          ) : (
            <Logo height={72} alt="Corner Room" />
          )}
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
