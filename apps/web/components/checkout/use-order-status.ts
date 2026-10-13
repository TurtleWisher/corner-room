"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchOrder, type OrderRecord } from "@/lib/api";
import { pollDelayMs, purchaseStage, shouldCelebrate, shouldPoll, type PurchaseStage } from "@/lib/checkout-view";

/**
 * Keeps an order in step with the server. Checks back with a gentle back-off while the order can
 * still change, pauses while the tab is hidden and checks again as soon as it is visible.
 * `celebrate` turns true only when this page saw the order become complete.
 */
export function useOrderStatus(initial: OrderRecord) {
  const [order, setOrderState] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [celebrate, setCelebrate] = useState(false);
  const stageRef = useRef<PurchaseStage>(purchaseStage(initial, Date.now()));
  // A page opened on an already-complete order shows the confirmation without the moment.
  const seenOpen = useRef(stageRef.current !== "complete");
  const attempt = useRef(0);

  const setOrder = useCallback((next: OrderRecord) => {
    const stage = purchaseStage(next, Date.now());
    if (seenOpen.current && shouldCelebrate(stageRef.current, stage)) setCelebrate(true);
    stageRef.current = stage;
    setOrderState(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setOrder(await fetchOrder(initial.id));
    } catch {
      // A failed check changes nothing; the next one tries again.
    }
  }, [initial.id, setOrder]);

  const stage = purchaseStage(order, now);

  // Status checks.
  useEffect(() => {
    if (!shouldPoll(stage)) return;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") {
          attempt.current += 1;
          await refresh();
        }
        schedule();
      }, pollDelayMs(attempt.current));
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [stage, refresh]);

  // A one-second clock for the reservation countdown, only while one is running.
  useEffect(() => {
    if (!order.hold_expires_at || stage !== "awaiting_payment") return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [order.hold_expires_at, stage]);

  return { order, stage, now, setOrder, refresh, celebrate, clearCelebrate: () => setCelebrate(false) };
}
