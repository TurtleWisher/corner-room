"use client";

/*
 * Commerce (redesigned 2026-11-27, D-CUSTOMERS-03): what needs staff now first (payments to check,
 * prices to agree, refunds), then pre-sales, then the products and prices on sale. Raised tiles at
 * the top count each queue (the console's shared queue counts) and jump to it; every payment check
 * opens its buyer's page in Customers and users. The forms that make a product or a price by hand
 * are folded away at the end. The server decides everything; nothing here computes money.
 */

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Users } from "lucide-react";

import { StatusChip } from "@/components/ds";
import { useSpotlight } from "@/components/ds/spotlight";
import { StatTile } from "@/components/staff/customers-kit";
import { Button, EmptyState, ErrorState, Input, LoadingState, Protected } from "@/components/staff/kit";
import { PaymentChecks } from "@/components/staff/payment-checks";
import { PriceProposals } from "@/components/staff/price-proposals";
import { Presales } from "@/components/staff/presales";
import { Refunds } from "@/components/staff/refunds";
import { useStaffQueues } from "@/components/staff/staff-queues";
import { useWorkspace } from "@/components/workspace-provider";
import {
  ApiError,
  createOffer,
  createProduct,
  fetchStaffProducts,
  transitionOffer,
  transitionProduct,
  type ProductRecord,
} from "@/lib/api";
import { formatCount } from "@/lib/format/count";

/** Kinds Corner Room no longer sells (owner, 2026-10-23, D-COMMERCE-01); old rows only. */
const RETIRED_TYPES = new Set(["CATALOG_ACCESS", "SUBSCRIPTION_PLAN"]);
const KIND: Record<string, string> = { TRACK: "Song", RELEASE: "Release", TICKET: "Ticket", CATALOG_ACCESS: "Catalog pass (retired)", SUBSCRIPTION_PLAN: "Subscription (retired)" };

const SECTIONS = [
  { id: "q-payments", label: "Payments to check", queue: "payments" },
  { id: "q-prices", label: "Prices to agree", queue: "prices" },
  { id: "q-refunds", label: "Refunds", queue: "refunds" },
  { id: "q-presales", label: "Pre-sales", queue: null },
  { id: "q-products", label: "Products on sale", queue: null },
] as const;

function CommerceBody() {
  const { currentOrg } = useWorkspace();
  const queues = useStaffQueues();
  const spotRef = useSpotlight<HTMLDivElement>();
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [productType, setProductType] = useState("TRACK");
  const [offerProductId, setOfferProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [byHand, setByHand] = useState(false);

  async function reload() {
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const productPage = await fetchStaffProducts();
      setProducts(productPage.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load commerce");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload reads the workspace
  }, [currentOrg]);

  async function onProduct(form: FormEvent) {
    form.preventDefault();
    setError(null);
    try {
      await createProduct({ product_type: productType, subject_id: subjectId, name });
      setName("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Product create failed");
    }
  }

  async function onOffer(form: FormEvent) {
    form.preventDefault();
    setError(null);
    try {
      const offer = await createOffer({
        product_id: offerProductId,
        amount_minor: Number.parseInt(amount, 10),
        currency_code: currency,
      });
      await transitionOffer(offer.id, "activate", offer.version ?? undefined);
      setAmount("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Offer create failed");
    }
  }

  const countOf = (key: string | null) => (key ? (queues.queues.find((q) => q.key === key)?.count ?? null) : null);
  const onSale = useMemo(() => products.filter((p) => p.status === "ACTIVE" && !RETIRED_TYPES.has(p.product_type)).length, [products]);

  if (!currentOrg) {
    return <EmptyState message="Select an organization to configure commerce." />;
  }

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const tone = (n: number | null) => (n && n > 0 ? ("warning" as const) : undefined);

  return (
    <div className="cx" data-module="commerce" ref={spotRef}>
      <header className="cx-head">
        <div>
          <p className="cx-eyebrow">Money</p>
          <h1 className="cx-title">Commerce</h1>
          <p className="cx-lede">
            Payments to check, prices to agree and refunds first, then pre-sales and what is on sale. Corner Room sells songs, releases and
            tickets one by one: no subscriptions or catalog pass (D-COMMERCE-01).
          </p>
        </div>
        <Link href="/staff/customers" className="cx-ghost cr-cut cr-focus">
          <Users aria-hidden="true" className="size-4" /> Customers and users <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </header>

      <div className="cx-tiles" style={{ "--cx-cols": 4 } as React.CSSProperties} role="group" aria-label="Jump to a queue">
        <StatTile
          label="Payments to check"
          value={countOf("payments") === null ? "–" : formatCount(countOf("payments"))}
          hint="Find each on the statement"
          tone={tone(countOf("payments"))}
          onPress={() => jump("q-payments")}
        />
        <StatTile
          label="Prices to agree"
          value={countOf("prices") === null ? "–" : formatCount(countOf("prices"))}
          hint="Proposed by artists"
          tone={tone(countOf("prices"))}
          onPress={() => jump("q-prices")}
          style={{ "--i": 1 } as React.CSSProperties}
        />
        <StatTile
          label="Refunds open"
          value={countOf("refunds") === null ? "–" : formatCount(countOf("refunds"))}
          hint="Waiting for a decision"
          tone={tone(countOf("refunds"))}
          onPress={() => jump("q-refunds")}
          style={{ "--i": 2 } as React.CSSProperties}
        />
        <StatTile
          label="Products on sale"
          value={loading ? "–" : formatCount(onSale)}
          hint="Songs, releases and tickets"
          tone="positive"
          onPress={() => jump("q-products")}
          style={{ "--i": 3 } as React.CSSProperties}
        />
      </div>

      <nav className="cx-chips" aria-label="Sections">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="cx-chip cr-cut cr-focus" onClick={(e) => (e.preventDefault(), jump(s.id))}>
            {s.label}
            {s.queue && countOf(s.queue) ? <span className="cx-chip-count">{formatCount(countOf(s.queue))}</span> : null}
          </a>
        ))}
      </nav>

      {error ? <ErrorState title="Commerce" message={error} /> : null}

      <section id="q-payments" className="cx-glass cr-cut cx-pad cx-well scroll-mt-6" data-spot>
        <PaymentChecks />
      </section>
      <section id="q-prices" className="cx-glass cr-cut cx-pad cx-well scroll-mt-6" data-spot>
        <PriceProposals onDecided={() => void reload()} />
      </section>
      <section id="q-refunds" className="cx-glass cr-cut cx-pad cx-well scroll-mt-6" data-spot>
        <Refunds />
      </section>
      <section id="q-presales" className="cx-glass cr-cut cx-pad cx-well scroll-mt-6" data-spot>
        <Presales products={products} />
      </section>

      <section id="q-products" className="cx-glass cr-cut cx-pad cx-well scroll-mt-6" aria-labelledby="products-title" data-spot>
        <div className="cx-section-title">
          <h2 id="products-title" className="text-lg font-semibold">
            Products
          </h2>
          <span className="cx-quiet">
            {formatCount(onSale)} on sale · {formatCount(products.length)} in all
          </span>
        </div>
        {loading ? (
          <LoadingState label="Loading products" />
        ) : products.length === 0 ? (
          <EmptyState message="No products yet. Agreeing an artist's price makes one." />
        ) : (
          <ul className="cx-mini">
            {products.map((row) => (
              <li key={row.id} className="flex-wrap">
                <span className="min-w-0">
                  <span className="font-semibold">{row.name}</span>{" "}
                  <span className="cx-quiet">
                    · {KIND[row.product_type] ?? row.product_type} · <span className="cx-mono">{row.id.slice(0, 8)}</span>
                  </span>
                  {RETIRED_TYPES.has(row.product_type) ? <span className="cx-quiet block">No longer sold: Corner Room has no subscriptions or catalog pass.</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <StatusChip value={row.status} />
                  {RETIRED_TYPES.has(row.product_type) && row.status === "ACTIVE" ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => void transitionProduct(row.id, "retire", row.version).then(() => reload())}>
                      Retire
                    </Button>
                  ) : null}
                  {row.status === "DRAFT" && !RETIRED_TYPES.has(row.product_type) ? (
                    <Button type="button" size="sm" onClick={() => void transitionProduct(row.id, "activate", row.version).then(() => reload())}>
                      Activate
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-line pt-3">
          <button type="button" className="cx-ghost cr-cut cr-focus" aria-expanded={byHand} aria-controls="cx-by-hand" onClick={() => setByHand(!byHand)}>
            <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${byHand ? "rotate-180" : ""}`} />
            Make a product or price by hand
          </button>
          <div id="cx-by-hand" className="cx-fold" data-open={byHand || undefined}>
            <div inert={!byHand}>
              <p className="cx-quiet mt-3">
                Rarely needed: agreeing an artist&apos;s proposed price makes both. Enter prices in the currency&apos;s smallest unit (for BDT,
                poisha: 150000 is ৳1,500).
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <form onSubmit={onProduct} className="cx-attempt cr-cut space-y-3">
                  <p className="font-semibold">New product</p>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" />
                  <Input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} placeholder="Song or release UUID" />
                  <Input value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="TRACK or RELEASE" />
                  <Button type="submit" size="sm">
                    Create product
                  </Button>
                </form>
                <form onSubmit={onOffer} className="cx-attempt cr-cut space-y-3">
                  <p className="font-semibold">New price</p>
                  <Input value={offerProductId} onChange={(e) => setOfferProductId(e.target.value)} placeholder="Product UUID" />
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount minor" />
                  <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" />
                  <Button type="submit" size="sm">
                    Create and activate price
                  </Button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function StaffCommercePage() {
  return (
    <Protected>
      <CommerceBody />
    </Protected>
  );
}
