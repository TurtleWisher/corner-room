"use client";

import { FormEvent, useEffect, useState } from "react";

import { Protected } from "@/components/protected";
import { useWorkspace } from "@/components/workspace-provider";
import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  createOffer,
  createPlan,
  createProduct,
  fetchStaffPlans,
  fetchStaffProducts,
  transitionOffer,
  transitionPlan,
  transitionProduct,
  type PlanRecord,
  type ProductRecord,
} from "@/lib/api";

function CommerceBody() {
  const { currentOrg } = useWorkspace();
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [productType, setProductType] = useState("TRACK");
  const [offerProductId, setOfferProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [planKey, setPlanKey] = useState("");
  const [planAmount, setPlanAmount] = useState("");
  const [interval, setInterval] = useState("MONTH");
  const [intervalCount, setIntervalCount] = useState("1");

  async function reload() {
    if (!currentOrg) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [productPage, planPage] = await Promise.all([fetchStaffProducts(), fetchStaffPlans()]);
      setProducts(productPage.items);
      setPlans(planPage.items);
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

  async function onPlan(form: FormEvent) {
    form.preventDefault();
    setError(null);
    try {
      const plan = await createPlan({
        key: planKey,
        price_amount_minor: Number.parseInt(planAmount, 10),
        currency_code: currency,
        interval,
        interval_count: Number.parseInt(intervalCount, 10),
      });
      await transitionPlan(plan.id, "activate");
      setPlanKey("");
      setPlanAmount("");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Plan create failed");
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
      <h1 className="text-xl font-semibold">Staff commerce</h1>
      <p className="text-sm text-neutral-600">
        Type integer minor units. The UI does not invent prices, trials, or fees. Requires
        commerce.write.
      </p>
      {error ? <ErrorState title="Commerce" message={error} /> : null}
      <Card>
        <form onSubmit={onProduct} className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name" />
          <Input value={subjectId} onChange={(e) => setSubjectId(e.target.value)} placeholder="Track or plan UUID" />
          <Input value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="TRACK" />
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
      <Card>
        <form onSubmit={onPlan} className="space-y-3">
          <Input value={planKey} onChange={(e) => setPlanKey(e.target.value)} placeholder="Plan key" />
          <Input value={planAmount} onChange={(e) => setPlanAmount(e.target.value)} placeholder="Amount minor" />
          <Input value={interval} onChange={(e) => setInterval(e.target.value)} placeholder="MONTH" />
          <Input
            value={intervalCount}
            onChange={(e) => setIntervalCount(e.target.value)}
            placeholder="Interval count"
          />
          <Button type="submit" size="sm">
            Create and activate plan
          </Button>
        </form>
      </Card>
      <section className="space-y-3">
        {products.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">
              {row.name} · {row.status}
            </p>
            <p className="text-sm text-neutral-600">
              {row.product_type} · {row.id}
            </p>
            {row.status === "DRAFT" ? (
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
        {plans.map((row) => (
          <Card key={row.id}>
            <p className="font-medium">
              {row.key} · {row.status}
            </p>
            <p className="text-sm text-neutral-600">
              {row.price_amount_minor} {row.currency_code}
            </p>
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
