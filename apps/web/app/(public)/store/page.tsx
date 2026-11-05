"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { ButtonLink, Card, EmptyState, ErrorState, Money, Skeleton } from "@/components/ds";
import { PageIntro, RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { type PresalePageRecord } from "@/features/catalog/api";
import { fetchPresales } from "@/features/presales/api";
import { PresaleCard } from "@/components/music/presale-card";
import { fetchOffers, type OfferRecord } from "@/lib/api";
import { maybeCoverUrl, offerCoverSource } from "@/lib/cover-view";
import { groupOffers, offerTitle, productKind } from "@/lib/store-view";

function BuyLink({ href, children, label, className, presale = false }: { href: string; children: React.ReactNode; label: string; className?: string; presale?: boolean }) {
  const { status } = useAuth();
  if (status !== "authenticated") {
    return (
      <ButtonLink href={`/login?next=${encodeURIComponent(href)}`} variant={presale ? "brand" : "secondary"} block className={className} aria-label={`Sign in to ${label}`}>
        {presale ? "Sign in to pre-book" : "Sign in to buy"}
      </ButtonLink>
    );
  }
  return (
    <ButtonLink href={href} variant={presale ? "brand" : undefined} block className={className} aria-label={label}>
      {children}
    </ButtonLink>
  );
}

function OfferCard({ offer, presale }: { offer: OfferRecord; presale?: PresalePageRecord | null }) {
  // A pre-sale reads the same everywhere (D-PRESALE-04): the shared pre-sale card.
  if (offer.audience === "PRESALE" && offer.product_type === "RELEASE") {
    return presale ? <PresaleCard presale={presale} place="STORE" /> : null;
  }
  const title = offerTitle(offer);
  const checkoutHref = `/checkout?offer=${offer.id}`;
  const cover = maybeCoverUrl(offerCoverSource(offer.product_type, offer.subject_id), 480);
  return (
    <Card as="article" className="flex h-full flex-col p-4">
      <CoverArt src={cover} fallback={<RoomCube front={title} side={title} tone="sky" label="" className="w-full" />} className="w-full" />
      <h3 className="mt-4 truncate text-base font-bold text-fg">{title}</h3>
      {productKind(offer.product_type) !== title ? <p className="text-xs text-fg-muted">{productKind(offer.product_type)}</p> : null}
      <p className="mt-3 flex-1">
        <Money value={{ amount_minor: offer.amount_minor, currency_code: offer.currency_code }} variant="display" className="text-2xl text-highlight" />
      </p>
      <div className="mt-4">
        <BuyLink href={checkoutHref} label={`Buy ${title}`}>Buy</BuyLink>
      </div>
    </Card>
  );
}

export default function StorePage() {
  const data = useAsync(async () => {
    const offers = (await fetchOffers()).items;
    const hasPresale = offers.some((offer) => offer.audience === "PRESALE" && offer.product_type === "RELEASE");
    const presales = hasPresale ? await fetchPresales({ limit: 48 }).catch(() => [] as PresalePageRecord[]) : [];
    return { offers, presales: new Map(presales.map((p) => [p.id, p])) };
  }, []);

  return (
    <main id="main" data-theme="ember" data-module="store" className="cr-scope">
      <LitSurface as="section" theme="ember" aria-labelledby="store-title">
        <div className="mx-auto max-w-[90rem] px-4 pb-10 pt-12 md:px-6 md:pt-16">
          <div id="store-title">
            <PageIntro eyebrow="Store" title="Music to keep" lede="Buy songs and releases straight from the artists, and keep them." />
          </div>
        </div>
      </LitSurface>

      <div className="mx-auto max-w-[90rem] space-y-14 px-4 pb-16 pt-4 md:px-6">
        {data.status === "loading" ? (
          <div className="grid gap-6 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 w-full" />
            ))}
          </div>
        ) : data.status === "error" ? (
          <ErrorState title="The Store is unavailable" message={loadErrorMessage(data.error, "the Store")} action={<RetryButton onClick={data.reload} />} />
        ) : data.data.offers.length === 0 ? (
          <EmptyState title="Nothing on sale yet" body="Music will appear here when it goes on sale." />
        ) : (
          <>
            {groupOffers(data.data.offers).map((group) => (
              <section key={group.type} aria-labelledby={`store-${group.type}`}>
                <h2 id={`store-${group.type}`} className="mb-5 text-xl font-bold text-fg md:text-2xl">
                  {group.label}
                </h2>
                <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {group.offers.filter((offer) => group.type !== "PRESALE" || data.data.presales.has(offer.subject_id ?? "")).map((offer) => (
                    <li key={offer.id}>
                      <OfferCard offer={offer} presale={offer.subject_id ? data.data.presales.get(offer.subject_id) : null} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
        <p className="text-sm text-fg-muted">
          Already bought something?{" "}
          <Link href="/purchases" className="cr-focus font-semibold text-link underline">
            See your purchases
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
