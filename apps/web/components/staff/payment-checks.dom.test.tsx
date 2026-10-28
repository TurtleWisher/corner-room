// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StaffSubmission } from "@/features/commerce/api";

const api = { fetchStaffSubmissions: vi.fn(), confirmSubmission: vi.fn(), rejectSubmission: vi.fn() };
vi.mock("@/features/commerce/api", () => ({
  fetchStaffSubmissions: (status?: string) => api.fetchStaffSubmissions(status),
  confirmSubmission: (id: string) => api.confirmSubmission(id),
  rejectSubmission: (id: string, reason: string) => api.rejectSubmission(id, reason),
}));

import { PaymentChecks } from "./payment-checks";

const ROW: StaffSubmission = {
  id: "s1",
  order_id: "01a14e89-b836-7717-98af-66919a05277e",
  purpose: "TICKET",
  amount_minor: 100000,
  currency_code: "BDT",
  transaction_ref: "8N7A6B5C4D",
  paid_from: "+8801712345678",
  paid_with: "BKASH",
  status: "SUBMITTED",
  decision_note: null,
  buyer_email: "f***@example.com",
  submitted_at: "2026-10-18T10:00:00Z",
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchStaffSubmissions.mockResolvedValue([ROW]);
});
afterEach(cleanup);

describe("PaymentChecks", () => {
  it("shows what the buyer sent and confirms it", async () => {
    api.confirmSubmission.mockResolvedValue({ ...ROW, status: "CONFIRMED" });
    render(<PaymentChecks />);
    expect(await screen.findByText("8N7A6B5C4D")).toBeTruthy();
    expect(screen.getByText("+8801712345678")).toBeTruthy();
    expect(screen.getByText(/CR-9A05277E/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /confirm payment/ }));
    await waitFor(() => expect(api.confirmSubmission).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(api.fetchStaffSubmissions).toHaveBeenCalledTimes(2));
  });

  it("needs a reason the buyer will see before rejecting", async () => {
    api.rejectSubmission.mockResolvedValue({ ...ROW, status: "REJECTED" });
    render(<PaymentChecks />);
    fireEvent.click(await screen.findByRole("button", { name: /Not found: reject/ }));
    const send = screen.getByRole("button", { name: "Send rejection" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason the buyer will see/), { target: { value: "Not on the bKash statement" } });
    fireEvent.click(send);
    await waitFor(() => expect(api.rejectSubmission).toHaveBeenCalledWith("s1", "Not on the bKash statement"));
  });

  it("keeps rejected payments visible with the reason, without action buttons (owner, 2026-10-28)", async () => {
    render(<PaymentChecks />);
    await screen.findByText("8N7A6B5C4D");
    expect(api.fetchStaffSubmissions).toHaveBeenLastCalledWith("SUBMITTED");
    api.fetchStaffSubmissions.mockResolvedValue([
      { ...ROW, id: "s2", transaction_ref: "AUTULGIFT2026", paid_with: "OTHER", status: "REJECTED", decision_note: "This was a gift", decided_at: "2026-10-28T09:00:00Z" },
    ]);
    fireEvent.click(screen.getByRole("tab", { name: "Rejected" }));
    expect(await screen.findByText("AUTULGIFT2026")).toBeTruthy();
    expect(api.fetchStaffSubmissions).toHaveBeenLastCalledWith("REJECTED");
    expect(screen.getByText("This was a gift")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /confirm payment/ })).toBeNull();
    expect(screen.getByRole("tab", { name: "Rejected" }).getAttribute("aria-selected")).toBe("true");
  });

  it("says when nothing is waiting", async () => {
    api.fetchStaffSubmissions.mockResolvedValue([]);
    render(<PaymentChecks />);
    expect(await screen.findByText("No payments are waiting to be checked.")).toBeTruthy();
  });
});
