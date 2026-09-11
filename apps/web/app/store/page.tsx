"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { ErrorState, LoadingState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ApiError,
  createCatalogOrder,
  createSubscriptionOrder,
  fetchOffers,
  fetchSubscriptionPlans,
  sandboxConfirmPayment,
  type OfferRecord,
  type OrderRecord,
  type PlanRecord,
} from "@/lib/api";

function newKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `store-${Date.now()}`;
}

export default function StorePage() {
  const { status } = useAuth();
  const [offers, setOffers] = useState<OfferRecord[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const offerKey = useMemo(newKey, []);
  const planKey = useMemo(newKey, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchOffers(), fetchSubscriptionPlans()])
      .then(([offerPage, planPage]) => {
        if (!cancelled) {
          setOffers(offerPage.items);
          setPlans(planPage.items);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Unable to load store");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function buyOffer(offerId: string) {
    setError(null);
    try {
      const created = await createCatalogOrder(offerId, offerKey);
      setOrder(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Checkout failed");
    }
  }

  async function subscribe(planId: string) {
    setError(null);
    try {
      const created = await createSubscriptionOrder(planId, planKey);
      setOrder(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Subscribe failed");
    }
  }

  async function capture() {
    if (!order?.payment?.id) {
      return;
    }
    setError(null);
    try {
      setOrder(await sandboxConfirmPayment(order.payment.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sandbox capture failed");
    }
  }

  if (loading) {
    return <LoadingState label="Loading store" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Store</h1>
      <p className="text-sm text-neutral-600">
        Amounts come from staff-configured offers and plan versions. There is no card form. Sandbox
        confirm is not a production PSP.
      </p>
      {error ? <ErrorState title="Store" message={error} /> : null}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-500">Offers</h2>
        {offers.length === 0 ? (
          <p className="text-sm text-neutral-600">No active offers.</p>
        ) : (
          offers.map((offer) => (
            <Card key={offer.id}>
              <p className="font-medium">{offer.name ?? offer.product_type}</p>
              <p className="text-sm text-neutral-600">
                {offer.amount_minor} {offer.currency_code}
              </p>
              {status === "authenticated" ? (
                <Button type="button" size="sm" className="mt-3" onClick={() => void buyOffer(offer.id)}>
                  Buy
                </Button>
              ) : (
                <Link href="/login" className="mt-3 inline-block text-sm underline">
                  Sign in to buy
                </Link>
              )}
            </Card>
          ))
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-500">Plans</h2>
        {plans.length === 0 ? (
          <p className="text-sm text-neutral-600">No active plans.</p>
        ) : (
          plans.map((plan) => (
            <Card key={plan.id}>
              <p className="font-medium">{plan.key}</p>
              <p className="text-sm text-neutral-600">
                {plan.price_amount_minor} {plan.currency_code} / {plan.interval_count} {plan.interval}
              </p>
              {status === "authenticated" ? (
                <Button type="button" size="sm" className="mt-3" onClick={() => void subscribe(plan.id)}>
                  Subscribe
                </Button>
              ) : (
                <Link href="/login" className="mt-3 inline-block text-sm underline">
                  Sign in to subscribe
                </Link>
              )}
            </Card>
          ))
        )}
      </section>
      {order ? (
        <Card>
          <p className="text-sm">
            Order {order.status} · {order.total_amount_minor} {order.currency_code}
          </p>
          <p className="mt-1 text-sm text-neutral-600">Payment {order.payment?.status}</p>
          {order.payment?.status === "REQUIRES_ACTION" ? (
            <Button type="button" size="sm" className="mt-3" onClick={() => void capture()}>
              Complete sandbox payment
            </Button>
          ) : null}
          {order.status === "FULFILLED" ? (
            <p className="mt-3 text-sm">
              Fulfilled.{" "}
              <Link href="/purchases" className="underline">
                View purchases
              </Link>
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
