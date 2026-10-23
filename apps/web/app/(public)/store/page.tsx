"use client";

import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { LitSurface } from "@/components/brand/corner-light";
import { CoverArt } from "@/components/brand/cover-art";
import { RoomCube } from "@/components/brand/room-cube";
import { ButtonLink, Card, EmptyState, ErrorState, Money, Skeleton } from "@/components/ds";
import { PageIntro, RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchOffers, type OfferRecord } from "@/lib/api";
import { maybeCoverUrl, offerCoverSource } from "@/lib/cover-view";
import { groupOffers, offerTitle, productKind } from "@/lib/store-view";

function BuyLink({ href, children, label }: { href: string; children: React.ReactNode; label: string }) {
  const { status } = useAuth();
  if (status !== "authenticated") {
    return (
      <ButtonLink href={`/login?next=${encodeURIComponent(href)}`} variant="secondary" block aria-label={`Sign in to ${label}`}>
        Sign in to buy
      </ButtonLink>
    );
  }
  return (
    <ButtonLink href={href} block aria-label={label}>
      {children}
    </ButtonLink>
  );
}

function OfferCard({ offer }: { offer: OfferRecord }) {
  const title = offerTitle(offer);
  return (
    <Card as="article" className="flex h-full flex-col p-4">
      <CoverArt
        src={maybeCoverUrl(offerCoverSource(offer.product_type, offer.subject_id), 480)}
        fallback={<RoomCube front={title} side={title} tone="sky" label="" className="w-full" />}
        className="w-full"
      />
      <h3 className="mt-4 truncate text-base font-bold text-fg">{title}</h3>
      {productKind(offer.product_type) !== title ? <p className="text-xs text-fg-muted">{productKind(offer.product_type)}</p> : null}
      <p className="mt-3 flex-1">
        <Money value={{ amount_minor: offer.amount_minor, currency_code: offer.currency_code }} variant="display" className="text-2xl text-highlight" />
      </p>
      <div className="mt-4">
        <BuyLink href={`/checkout?offer=${offer.id}`} label={`Buy ${title}`}>
          Buy
        </BuyLink>
      </div>
    </Card>
  );
}

export default function StorePage() {
  const data = useAsync(() => fetchOffers().then((o) => ({ offers: o.items })), []);

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
                  {group.offers.map((offer) => (
                    <li key={offer.id}>
                      <OfferCard offer={offer} />
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
