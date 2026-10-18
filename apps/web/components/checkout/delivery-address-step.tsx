"use client";

/*
 * Checkout step before any payment (D-ADDR-01): the buyer confirms the Bangladesh address where
 * gifts can be sent, or adds one. The server refuses to start a payment without a saved address
 * and this confirmation; the page only collects them.
 */

import { useState } from "react";
import { Gift, MapPin, Pencil } from "lucide-react";

import { DeliveryAddressForm } from "@/components/account/delivery-address-form";
import { Button, Card, ErrorState, Skeleton } from "@/components/ds";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyDeliveryAddress, type DeliveryAddress } from "@/features/identity/api";
import { addressLines } from "@/lib/address-view";

export function DeliveryAddressStep({ confirmed, onConfirmedChange }: { confirmed: boolean; onConfirmedChange: (value: boolean) => void }) {
  const loaded = useAsync(fetchMyDeliveryAddress, []);
  const [address, setAddress] = useState<DeliveryAddress | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const current = address !== undefined ? address : loaded.status === "ok" ? loaded.data : undefined;

  function saved(next: DeliveryAddress) {
    setAddress(next);
    setEditing(false);
    // Saving it here is the confirmation for this order.
    onConfirmedChange(true);
  }

  return (
    <Card as="section" aria-labelledby="delivery-title" className="p-6">
      <h2 id="delivery-title" className="flex items-center gap-2 text-lg font-bold text-fg">
        <Gift aria-hidden="true" className="size-5 text-highlight" /> Where should we send gifts?
      </h2>
      {loaded.status === "loading" && current === undefined ? (
        <Skeleton className="mt-4 h-24 w-full" />
      ) : loaded.status === "error" && current === undefined ? (
        <div className="mt-4">
          <ErrorState message={loadErrorMessage(loaded.error, "your delivery address")} />
        </div>
      ) : current === null || editing ? (
        <div className="mt-4">
          <DeliveryAddressForm
            initial={current ?? null}
            onSaved={saved}
            onCancel={current ? () => setEditing(false) : undefined}
            submitLabel={current ? "Save and use this address" : "Save address"}
          />
        </div>
      ) : current ? (
        <div className="mt-4">
          <address className="flex items-start gap-3 not-italic text-sm text-fg">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            <span>
              {addressLines(current).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </span>
          </address>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-start gap-3 text-sm text-fg">
              <input type="checkbox" className="cr-focus mt-0.5 size-4" checked={confirmed} onChange={(e) => onConfirmedChange(e.target.checked)} />
              <span>Send any gifts for this order to this address</span>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onConfirmedChange(false);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden="true" /> Change
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
