// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RefundReason, StaffOrder } from "@/features/commerce/api";

const api = {
  fetchRefundReasons: vi.fn(),
  fetchStaffRefunds: vi.fn(),
  lookupStaffOrder: vi.fn(),
  requestTicketRefund: vi.fn(),
  requestRemainingRefund: vi.fn(),
  approveRefund: vi.fn(),
  completeSandboxRefund: vi.fn(),
  completeManualRefund: vi.fn(),
};
vi.mock("@/features/commerce/api", () => ({
  fetchRefundReasons: () => api.fetchRefundReasons(),
  fetchStaffRefunds: () => api.fetchStaffRefunds(),
  lookupStaffOrder: (ref: string) => api.lookupStaffOrder(ref),
  requestTicketRefund: (...args: unknown[]) => api.requestTicketRefund(...args),
  requestRemainingRefund: (...args: unknown[]) => api.requestRemainingRefund(...args),
  approveRefund: (id: string) => api.approveRefund(id),
  completeSandboxRefund: (id: string) => api.completeSandboxRefund(id),
  completeManualRefund: (id: string, ref: string) => api.completeManualRefund(id, ref),
}));

import { Refunds } from "./refunds";

const REASONS: RefundReason[] = [{ reason_code: "CUSTOMER_REQUEST", label: "Customer request", requires_finance_approve: true }];

function order(over: Partial<StaffOrder> = {}): StaffOrder {
  return {
    id: "01a14e89-b836-7717-98af-66919a05277e",
    status: "FULFILLED",
    purpose: "TICKET",
    total_amount_minor: 100000,
    currency_code: "BDT",
    created_at: "2026-10-18T10:23:00Z",
    buyer_email: "f***@example.com",
    payment_id: "pay-1",
    payment_status: "CAPTURED",
    payment_provider: "sandbox",
    refunded_amount_minor: 0,
    items: [],
    tickets: [
      { id: "t1", status: "ISSUED", ticket_type_name: "General", unit_amount_minor: 50000, currency_code: "BDT", refundable: true, refund_pending: false },
      { id: "t2", status: "REFUNDED", ticket_type_name: "General", unit_amount_minor: 50000, currency_code: "BDT", refundable: false, refund_pending: false },
    ],
    refunds: [],
    ...over,
  };
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchRefundReasons.mockResolvedValue(REASONS);
  api.fetchStaffRefunds.mockResolvedValue([]);
});
afterEach(cleanup);

async function findOrder(o: StaffOrder) {
  api.lookupStaffOrder.mockResolvedValue(o);
  render(<Refunds />);
  fireEvent.change(await screen.findByLabelText(/Order reference/), { target: { value: "cr-9a05 277e" } });
  fireEvent.click(screen.getByRole("button", { name: "Find order" }));
  await screen.findByText("Tickets to refund");
}

describe("Refunds", () => {
  it("looks the order up by its normalised reference and labels every control", async () => {
    await findOrder(order());
    expect(api.lookupStaffOrder).toHaveBeenCalledWith("CR-9A05277E");
    expect(screen.getByRole("checkbox", { name: /Ticket 1/ })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Reason/ })).toBeTruthy();
    // An already refunded ticket can't be picked, and says why.
    expect((screen.getByRole("checkbox", { name: /Ticket 2/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Already refunded")).toBeTruthy();
  });

  it("sends only the picked tickets and a reason, never an amount", async () => {
    api.requestTicketRefund.mockResolvedValue({ id: "r1", payment_id: "pay-1", status: "REQUESTED", amount_minor: 50000, currency_code: "BDT", reason_code: "CUSTOMER_REQUEST", ticket_ids: ["t1"] });
    await findOrder(order());
    const send = screen.getByRole("button", { name: "Send for finance approval" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Ticket 1/ }));
    fireEvent.change(screen.getByRole("combobox", { name: /Reason/ }), { target: { value: "CUSTOMER_REQUEST" } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(api.requestTicketRefund).toHaveBeenCalledTimes(1));
    const [orderId, ticketIds, reason, key] = api.requestTicketRefund.mock.calls[0];
    expect(orderId).toBe("01a14e89-b836-7717-98af-66919a05277e");
    expect(ticketIds).toEqual(["t1"]);
    expect(reason).toBe("CUSTOMER_REQUEST");
    expect(typeof key).toBe("string");
    expect(await screen.findByText("Sent for approval: 1 ticket.")).toBeTruthy();
  });

  it("refunds what is left on a non-ticket order", async () => {
    api.lookupStaffOrder.mockResolvedValue(order({ purpose: "TRACK", tickets: [] }));
    api.requestRemainingRefund.mockResolvedValue({ id: "r2", payment_id: "pay-1", status: "REQUESTED", amount_minor: 100000, currency_code: "BDT", reason_code: "CUSTOMER_REQUEST", ticket_ids: null });
    render(<Refunds />);
    fireEvent.change(await screen.findByLabelText(/Order reference/), { target: { value: "CR-9A05277E" } });
    fireEvent.click(screen.getByRole("button", { name: "Find order" }));
    await screen.findByText("Refunds everything still refundable on this order.");
    fireEvent.change(screen.getByRole("combobox", { name: /Reason/ }), { target: { value: "CUSTOMER_REQUEST" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for finance approval" }));
    await waitFor(() => expect(api.requestRemainingRefund).toHaveBeenCalledWith("01a14e89-b836-7717-98af-66919a05277e", "CUSTOMER_REQUEST", expect.any(String)));
  });

  it("says when a reference is not in this workspace", async () => {
    const { ApiError } = await import("@/lib/api/client");
    api.lookupStaffOrder.mockRejectedValue(new ApiError({ status: 404, code: "NOT_FOUND", title: "Not found" } as never));
    render(<Refunds />);
    fireEvent.change(await screen.findByLabelText(/Order reference/), { target: { value: "CR-9A05277E" } });
    fireEvent.click(screen.getByRole("button", { name: "Find order" }));
    expect(await screen.findByText("No order with that reference in this workspace.")).toBeTruthy();
  });

  it("refuses a reference that isn't one before calling the server", async () => {
    render(<Refunds />);
    fireEvent.change(await screen.findByLabelText(/Order reference/), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Find order" }));
    expect(await screen.findByText("An order reference looks like CR-1A2B3C4D.")).toBeTruthy();
    expect(api.lookupStaffOrder).not.toHaveBeenCalled();
  });
  it("a Bangla QR refund paid back by hand needs the transfer reference", async () => {
    api.fetchStaffRefunds.mockResolvedValue([
      { id: "r9", payment_id: "p9", order_id: "01a14e89-b836-7717-98af-66919a05277e", status: "APPROVED", amount_minor: 50000, currency_code: "BDT", reason_code: "CUSTOMER_REQUEST", ticket_ids: ["t1"], created_at: "2026-10-18T10:00:00Z", payment_provider: "bangla_qr" },
    ]);
    api.completeManualRefund.mockResolvedValue({ id: "r9", status: "COMPLETED" });
    render(<Refunds />);
    const done = (await screen.findByRole("button", { name: "Mark as paid back" })) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reference of the transfer you sent back/), { target: { value: "BK-REF-1" } });
    fireEvent.click(done);
    await waitFor(() => expect(api.completeManualRefund).toHaveBeenCalledWith("r9", "BK-REF-1"));
    expect(api.completeSandboxRefund).not.toHaveBeenCalled();
  });
});