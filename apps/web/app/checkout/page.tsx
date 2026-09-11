"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Protected } from "@/components/protected";
import { ErrorState } from "@/components/async-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ApiError,
  createHold,
  createOrder,
  sandboxConfirmPayment,
  type OrderRecord,
} from "@/lib/api";

function CheckoutBody() {
  const params = useSearchParams();
  const ticketTypeId = params.get("ticketTypeId") ?? "";
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const idempotencyKey = useMemo(
    () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `co-${Date.now()}`),
    [],
  );

  async function onHoldAndOrder(form: FormEvent) {
    form.preventDefault();
    setError(null);
    try {
      const hold = await createHold(ticketTypeId, Number.parseInt(quantity, 10));
      const created = await createOrder(hold.id, idempotencyKey);
      setOrder(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Checkout failed");
    }
  }

  async function onSandboxCapture() {
    if (!order?.payment?.id) {
      return;
    }
    setError(null);
    try {
      const paid = await sandboxConfirmPayment(order.payment.id);
      setOrder(paid);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sandbox capture failed");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Checkout</h1>
      <p className="text-sm text-neutral-600">
        Checkout creates a hold and a payment that still requires capture. The sandbox confirm is not a
        production PSP and is not a checkout success flag.
      </p>
      {error ? <ErrorState title="Checkout failed" message={error} /> : null}
      <Card>
        <form onSubmit={onHoldAndOrder} className="space-y-3">
          <Input value={ticketTypeId} readOnly />
          <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <Button type="submit" size="sm">
            Place order
          </Button>
        </form>
      </Card>
      {order ? (
        <Card>
          <p className="text-sm">
            Order {order.status} · {order.total_amount_minor} {order.currency_code}
          </p>
          <p className="mt-1 text-sm text-neutral-600">Payment {order.payment?.status}</p>
          {order.payment?.status === "REQUIRES_ACTION" ? (
            <Button type="button" size="sm" className="mt-3" onClick={() => void onSandboxCapture()}>
              Complete sandbox payment
            </Button>
          ) : null}
          {order.status === "FULFILLED" ? (
            <p className="mt-3 text-sm">
              Tickets issued.{" "}
              <Link href="/tickets" className="underline">
                View tickets
              </Link>
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Protected>
      <Suspense fallback={<p className="text-sm text-neutral-600">Loading checkout</p>}>
        <CheckoutBody />
      </Suspense>
    </Protected>
  );
}
