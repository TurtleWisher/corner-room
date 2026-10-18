// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrderRecord } from "@/lib/api";

const fetchOrder = vi.fn();
const sandboxConfirmPayment = vi.fn();
const submitPayment = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchOrder: (id: string) => fetchOrder(id),
    sandboxConfirmPayment: (id: string) => sandboxConfirmPayment(id),
    submitPayment: (id: string, body: unknown) => submitPayment(id, body),
  };
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
  submitPayment.mockReset();
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
    render(<PaymentPanel order={order()} stage="awaiting_payment" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/events/e" />);
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
    render(<PaymentPanel order={order({ hold_status: "EXPIRED" })} stage="expired" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/events/e" />);
    expect(screen.queryByText("The Bangla QR code goes here")).toBeNull();
    expect(screen.getByRole("link", { name: "Start again" }).getAttribute("href")).toBe("/events/e");
    expect(screen.getByRole("status").textContent).toMatch(/reservation has run out/);
  });

  it("says a late payment is safe and needs no second payment", () => {
    render(<PaymentPanel order={order({ status: "PAID", pay: "CAPTURED", hold_status: "EXPIRED" })} stage="paid_processing" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/" />);
    expect(screen.getByRole("status").textContent).toMatch(/do not need to pay again/);
    expect(screen.queryByRole("button", { name: /Complete test payment/ })).toBeNull();
  });

  it("lets the buyer send the app, transaction ID and number after paying (Q-PAY-01)", async () => {
    const onOrder = vi.fn();
    const checking = order({ payment_submission: { status: "SUBMITTED", transaction_ref: "8N7A6B5C4D", paid_with: "BKASH", decision_note: null, submitted_at: "2026-10-13T09:59:00Z" } });
    submitPayment.mockResolvedValue(checking);
    render(<PaymentPanel order={order()} stage="awaiting_payment" now={NOW} onOrder={onOrder} onRefresh={noop} restartHref="/" />);
    const send = screen.getByRole("button", { name: "Send payment details" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Paid with/), { target: { value: "BKASH" } });
    fireEvent.change(screen.getByLabelText(/Transaction ID/), { target: { value: "8n7a6b5c4d" } });
    fireEvent.change(screen.getByLabelText(/Number you paid from/), { target: { value: "01712 345678" } });
    fireEvent.click(send);
    await act(async () => {});
    expect(submitPayment).toHaveBeenCalledWith("pay-1", { transaction_ref: "8n7a6b5c4d", paid_from: "01712 345678", paid_with: "BKASH" });
    expect(onOrder).toHaveBeenCalledWith(checking);
  });

  it("while staff check, says so and hides the code and the form (Q-PAY-05)", () => {
    const checking = order({ payment_submission: { status: "SUBMITTED", transaction_ref: "8N7A6B5C4D", paid_with: "BKASH", decision_note: null, submitted_at: "2026-10-13T09:59:00Z" } });
    render(<PaymentPanel order={checking} stage="verifying" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/" />);
    expect(screen.getByRole("status").textContent).toMatch(/checking your bKash payment \(transaction 8N7A6B5C4D\)\. Your seats stay held/);
    expect(screen.queryByText("The Bangla QR code goes here")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send payment details" })).toBeNull();
  });

  it("after a rejection shows the staff reason above the form", () => {
    const rejected = order({ payment_submission: { status: "REJECTED", transaction_ref: "8N7A6B5C4D", paid_with: "NAGAD", decision_note: "Transaction ID not found", submitted_at: "2026-10-13T09:59:00Z" } });
    render(<PaymentPanel order={rejected} stage="awaiting_payment" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/" />);
    expect(screen.getByRole("alert").textContent).toMatch(/Transaction ID not found/);
    expect(screen.getByRole("button", { name: "Send payment details" })).toBeTruthy();
  });

  it("says why an unpaid order was cancelled and offers a fresh start (Q-COM-03)", () => {
    render(<PaymentPanel order={order({ status: "CANCELLED", hold_status: "EXPIRED" })} stage="cancelled" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/events/e" />);
    expect(screen.getByRole("status").textContent).toMatch(/reservation ran out before the payment arrived/);
    expect(screen.getByRole("link", { name: "Start again" }).getAttribute("href")).toBe("/events/e");
    expect(screen.queryByText("The Bangla QR code goes here")).toBeNull();
  });

  it("tells a buyer whose money arrived after cancellation that it will be refunded", () => {
    render(
      <PaymentPanel order={order({ status: "CANCELLED", pay: "CAPTURED", hold_status: "EXPIRED" })} stage="late_payment" now={NOW} onOrder={() => {}} onRefresh={noop} restartHref="/" />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/refund it in full/);
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
