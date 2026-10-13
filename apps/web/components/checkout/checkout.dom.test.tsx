// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderRecord } from "@/lib/api";

const fetchOrder = vi.fn();
const sandboxConfirmPayment = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchOrder: (id: string) => fetchOrder(id), sandboxConfirmPayment: (id: string) => sandboxConfirmPayment(id) };
});

import { PaymentPanel } from "./payment-panel";
import { POWER_TRANSITION_MS, POWER_TRANSITION_REDUCED_MS, PowerTransition } from "./power-transition";
import { useOrderStatus } from "./use-order-status";

const NOW = Date.parse("2026-10-13T10:00:00Z");

function order(over: Partial<OrderRecord> & { pay?: string; selfConfirm?: boolean; qr?: string | null; mode?: "test" | "live" } = {}): OrderRecord {
  const { pay = "REQUIRES_ACTION", selfConfirm = true, qr = null, mode = "test", ...rest } = over;
  return {
    id: "01a12c0a-5420-7cdf-8446-cc15618ee0bc",
    status: "PENDING_PAYMENT",
    purpose: "TICKET",
    total_amount_minor: 300000,
    currency_code: "BDT",
    payment: { id: "pay-1", order_id: "o", status: pay, amount_minor: 300000, currency_code: "BDT", provider: "sandbox", mode, self_confirm_available: selfConfirm, qr_image_url: qr },
    items: [],
    hold_expires_at: "2026-10-13T10:10:00Z",
    hold_status: "ACTIVE",
    ...rest,
  };
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
  fetchOrder.mockReset();
  sandboxConfirmPayment.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PowerTransition", () => {
  it("renders nothing until the parent passes a confirmed success", () => {
    const { container } = render(<PowerTransition confirmed={false} title="Payment received" onDone={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("plays, focuses Continue, and hands over when the motion ends", () => {
    const onDone = vi.fn();
    render(<PowerTransition confirmed title="Payment received" detail="Your tickets are ready." onDone={onDone} />);
    const dialog = screen.getByRole("dialog", { name: "Payment received" });
    expect(dialog).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Continue");
    act(() => vi.advanceTimersByTime(POWER_TRANSITION_MS - 1));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("never blocks: Continue, Escape or a click hand over at once, and only once", () => {
    const onDone = vi.fn();
    render(<PowerTransition confirmed title="Payment received" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.keyDown(window, { key: "Escape" });
    act(() => vi.advanceTimersByTime(POWER_TRANSITION_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("uses the short, still version under reduced motion", () => {
    setReducedMotion(true);
    const onDone = vi.fn();
    render(<PowerTransition confirmed title="Payment received" onDone={onDone} />);
    act(() => vi.advanceTimersByTime(POWER_TRANSITION_REDUCED_MS));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("PaymentPanel", () => {
  const noop = async () => {};

  it("shows a marked sample (not a QR) on a test server without an image, and the test button", () => {
    render(<PaymentPanel order={order()} stage="awaiting_payment" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/discover/e" />);
    expect(screen.getByText("The Bangla QR code goes here")).toBeTruthy();
    expect(screen.getByText(/Not a payment code/)).toBeTruthy();
    expect(screen.queryByRole("img", { name: /payment code/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Complete test payment/ })).toBeTruthy();
    expect(screen.getByText("10:00")).toBeTruthy();
    expect(screen.queryByText(/Payment confirmed/)).toBeNull();
  });

  it("shows the configured QR unaltered, and no test button where self-confirm is off", () => {
    render(
      <PaymentPanel order={order({ qr: "/brand/payment/bangla-qr.png", selfConfirm: false })} stage="awaiting_payment" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/" />,
    );
    const img = screen.getByRole("img", { name: "Bangla QR payment code" });
    expect(img.getAttribute("src")).toBe("/brand/payment/bangla-qr.png");
    expect(img.closest(".cr-qr-tile")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Complete test payment/ })).toBeNull();
  });

  it("hides the code once the reservation has run out and offers a fresh start", () => {
    render(<PaymentPanel order={order({ hold_status: "EXPIRED" })} stage="expired" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/discover/e" />);
    expect(screen.queryByText("The Bangla QR code goes here")).toBeNull();
    expect(screen.getByRole("link", { name: "Start again" }).getAttribute("href")).toBe("/discover/e");
    expect(screen.getByRole("status").textContent).toMatch(/reservation has run out/);
  });

  it("says a late payment is safe and needs no second payment", () => {
    render(<PaymentPanel order={order({ status: "PAID", pay: "CAPTURED", hold_status: "EXPIRED" })} stage="paid_processing" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/" />);
    expect(screen.getByRole("status").textContent).toMatch(/do not need to pay again/);
    expect(screen.queryByRole("button", { name: /Complete test payment/ })).toBeNull();
  });

  it("the test button hands the server's answer up; it never marks anything paid itself", async () => {
    const onOrder = vi.fn();
    sandboxConfirmPayment.mockResolvedValue(order({ status: "FULFILLED", pay: "CAPTURED" }));
    render(<PaymentPanel order={order()} stage="awaiting_payment" now={NOW} onOrder={onOrder} onRefresh={noop} restartHref="/" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Complete test payment/ }));
    });
    expect(sandboxConfirmPayment).toHaveBeenCalledWith("pay-1");
    expect(onOrder).toHaveBeenCalledWith(expect.objectContaining({ status: "FULFILLED" }));
  });
});

describe("useOrderStatus", () => {
  it("celebrates only when it saw the order become complete", () => {
    const { result } = renderHook(() => useOrderStatus(order()));
    expect(result.current.celebrate).toBe(false);
    act(() => result.current.setOrder(order({ status: "FULFILLED", pay: "CAPTURED" })));
    expect(result.current.stage).toBe("complete");
    expect(result.current.celebrate).toBe(true);
  });

  it("does not celebrate when opened on an order that was already complete", () => {
    const { result } = renderHook(() => useOrderStatus(order({ status: "FULFILLED", pay: "CAPTURED" })));
    act(() => result.current.setOrder(order({ status: "FULFILLED", pay: "CAPTURED" })));
    expect(result.current.celebrate).toBe(false);
  });

  it("does not celebrate a failure or a captured-but-unfulfilled order", () => {
    const { result } = renderHook(() => useOrderStatus(order()));
    act(() => result.current.setOrder(order({ pay: "FAILED" })));
    expect(result.current.celebrate).toBe(false);
    act(() => result.current.setOrder(order({ status: "PAID", pay: "CAPTURED" })));
    expect(result.current.celebrate).toBe(false);
  });

  it("checks the server while waiting and stops once settled", async () => {
    fetchOrder.mockResolvedValue(order({ status: "FULFILLED", pay: "CAPTURED" }));
    const { result } = renderHook(() => useOrderStatus(order()));
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(fetchOrder).toHaveBeenCalledTimes(1);
    expect(result.current.stage).toBe("complete");
    expect(result.current.celebrate).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(fetchOrder).toHaveBeenCalledTimes(1);
  });
});
