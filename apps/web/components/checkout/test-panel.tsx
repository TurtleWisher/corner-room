"use client";

/*
 * A platform admin's test buy (owner, 2026-11-21, D-TEST-BUY-01): in place of the payment panel,
 * "Complete as a test". No money moves, and the order never reaches sales, royalties, finance, the
 * artist's emails, gift campaigns, pre-sale numbers or analytics. The server decides who may.
 */

import { useState } from "react";
import { FlaskConical } from "lucide-react";

import { Button, Card } from "@/components/ds";
import { completeTestOrder, type OrderRecord } from "@/features/ticketing/api";
import { friendlyError } from "@/lib/error-copy";
import { TEST_BUY_WORDS } from "@/lib/test-buy-view";

export function TestBuyNotice({ className }: { className?: string }) {
  return (
    <p role="note" className={`flex items-start gap-2 border-l-2 border-highlight pl-3 text-sm text-fg ${className ?? ""}`}>
      <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
      <span>
        <span className="font-semibold">{TEST_BUY_WORDS.title}.</span> {TEST_BUY_WORDS.body}
      </span>
    </p>
  );
}

export function TestPanel({ order, onOrder }: { order: OrderRecord; onOrder: (next: OrderRecord) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      onOrder(await completeTestOrder(order.id));
    } catch (err) {
      setError(friendlyError(err, "The test couldn't be completed."));
      setBusy(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="test-title" className="grid gap-4 p-6">
      <h2 id="test-title" className="flex items-center gap-2 text-lg font-bold text-fg">
        <FlaskConical aria-hidden="true" className="size-5 text-highlight" /> {TEST_BUY_WORDS.panelTitle}
      </h2>
      <TestBuyNotice />
      <Button size="lg" className="justify-self-start" busy={busy} onClick={() => void complete()}>
        {TEST_BUY_WORDS.button}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
