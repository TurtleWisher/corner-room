import Link from "next/link";

import { LitSurface } from "@/components/brand/corner-light";
import { DateTime } from "@/components/ds";
import { PageIntro } from "@/components/shell/staff-panel";
import type { LegalDocument } from "@/lib/legal-content";
import { LEGAL_LINKS, SUPPORT_EMAIL, supportMailto } from "@/lib/site-contact";

/**
 * A legal page: the Ember lit header, then the text on Paper (the world for documents, brand
 * skill 12), then how to reach us and the other legal pages.
 */
export function LegalPage({ doc, path }: { doc: LegalDocument; path: string }) {
  return (
    <main id="main" data-theme="ember" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="legal-title">
        <div id="legal-title" className="mx-auto max-w-3xl px-4 pb-10 pt-12 md:px-6 md:pt-16">
          <PageIntro eyebrow="Legal" title={doc.title} lede={doc.lede} />
          <p className="mt-4 text-sm text-fg">
            Last updated <DateTime value={doc.updated} format="date" />
          </p>
        </div>
      </LitSurface>
      <article data-theme="paper" aria-labelledby="legal-title" className="cr-scope">
        <div className="mx-auto max-w-3xl space-y-10 px-4 py-12 md:px-6">
          {doc.sections.map((section) => (
            <section key={section.heading} aria-labelledby={headingId(section.heading)}>
              <h2 id={headingId(section.heading)} className="text-xl font-bold text-fg">
                {section.heading}
              </h2>
              {section.paragraphs?.map((text) => (
                <p key={text} className="mt-3 leading-relaxed text-fg">
                  {text}
                </p>
              ))}
              {section.bullets ? (
                <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-fg">
                  {section.bullets.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
          <section aria-labelledby="legal-contact" className="border-t border-line pt-8">
            <h2 id="legal-contact" className="text-xl font-bold text-fg">
              Contact us
            </h2>
            <p className="mt-3 leading-relaxed text-fg">
              Questions about this page, your account or an order:{" "}
              <a href={supportMailto(doc.title)} className="cr-focus font-semibold underline">
                {SUPPORT_EMAIL}
              </a>
            </p>
            <nav aria-label="Legal pages" className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {LEGAL_LINKS.filter((link) => link.href !== path).map((link) => (
                <Link key={link.href} href={link.href} className="cr-focus font-semibold underline">
                  {link.label}
                </Link>
              ))}
            </nav>
          </section>
        </div>
      </article>
    </main>
  );
}

function headingId(heading: string): string {
  return `legal-${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
