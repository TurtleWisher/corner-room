"use client";

import { FormEvent, useEffect, useState } from "react";

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
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Protected } from "@/components/staff/kit";
import { PriceProposals } from "@/components/staff/price-proposals";
import { PaymentChecks } from "@/components/staff/payment-checks";
import { Refunds } from "@/components/staff/refunds";
import { StatusChip } from "@/components/ds";

/** Kinds Corner Room no longer sells (owner, 2026-10-23, D-COMMERCE-01); old rows only. */
const RETIRED_TYPES = new Set(["CATALOG_ACCESS", "SUBSCRIPTION_PLAN"]);

function CommerceBody() {
  const { currentOrg } = useWorkspace();
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [productType, setProductType] = useState("TRACK");
  const [offerProductId, setOfferProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");

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

  if (!currentOrg) {
    return <EmptyState message="Select an organization to configure commerce." />;
  }
  if (loading) {
    return <LoadingState label="Loading commerce" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Commerce</h1>
      <p className="text-sm text-fg-muted">
        Songs and releases for sale, and their prices. Corner Room has no subscriptions or whole-catalog pass (D-COMMERCE-01). Enter prices in
        the currency&apos;s smallest unit (for BDT, poisha: 150000 is ৳1,500).
      </p>
      {error ? <ErrorState title="Commerce" message={error} /> : null}
      <PaymentChecks />
      <PriceProposals onDecided={() => void reload()} />
      <Refunds />
      <Card>
        <form onSubmit={onProduct} className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" />
          <Input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} placeholder="Song or release UUID" />
          <Input value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="TRACK or RELEASE" />
          <Button type="submit" size="sm">
            Create product
          </Button>
        </form>
      </Card>
      <Card>
        <form onSubmit={onOffer} className="space-y-3">
          <Input
            value={offerProductId}
            onChange={(e) => setOfferProductId(e.target.value)}
            placeholder="Product UUID"
          />
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount minor" />
          <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" />
          <Button type="submit" size="sm">
            Create and activate offer
          </Button>
        </form>
      </Card>
      <section className="space-y-3">
        {products.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">
              {row.name} · <StatusChip value={row.status} />
            </p>
            <p className="text-sm text-fg-muted">
              {row.product_type} · {row.id}
            </p>
            {RETIRED_TYPES.has(row.product_type) ? (
              <p className="mt-2 text-sm text-fg-muted">No longer sold: Corner Room has no subscriptions or whole-catalog pass.</p>
            ) : null}
            {RETIRED_TYPES.has(row.product_type) && row.status === "ACTIVE" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => void transitionProduct(row.id, "retire", row.version).then(() => reload())}
              >
                Retire
              </Button>
            ) : null}
            {row.status === "DRAFT" && !RETIRED_TYPES.has(row.product_type) ? (
              <Button
                type="button"
                size="sm"
                className="mt-3"
                onClick={() => void transitionProduct(row.id, "activate", row.version).then(() => reload())}
              >
                Activate
              </Button>
            ) : null}
          </Card>
        ))}
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
