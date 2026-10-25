// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchPresales: vi.fn(), uploadPresales: vi.fn(), cancelPresale: vi.fn() }));
vi.mock("@/features/commerce/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/commerce/api")>()), ...api }));

import { Presales } from "./presales";

const PRODUCTS = [
  { id: "p1", organization_id: "o", product_type: "RELEASE", subject_id: "r1", name: "MIZULS single", status: "ACTIVE", version: 1 },
  { id: "p2", organization_id: "o", product_type: "SUBSCRIPTION_PLAN", subject_id: "x", name: "Old plan", status: "ACTIVE", version: 1 },
];

beforeEach(() => {
  api.fetchPresales.mockReset();
  api.uploadPresales.mockReset();
  api.cancelPresale.mockReset();
  api.fetchPresales.mockResolvedValue({
    product_id: "p1",
    items: [
      { id: "s1", email: "early@example.com", buyer_name: "Early", amount_minor: 25000, currency_code: "BDT", paid_on: "2026-09-01", status: "CLAIMED", claimed_at: "2026-10-26T00:00:00Z", order_id: "o1" },
      { id: "s2", email: "late@example.com", buyer_name: null, amount_minor: 40000, currency_code: "BDT", paid_on: null, status: "WAITING", claimed_at: null, order_id: null },
    ],
    totals: { BDT: { buyers: 2, claimed: 1, amount_minor: 65000, claimed_amount_minor: 25000 } },
  });
});
afterEach(cleanup);

describe("Pre-sales (DOM)", () => {
  it("offers only songs and releases, previews a pasted list and sends only email, name, amount and date", async () => {
    api.uploadPresales.mockResolvedValue({ added: 2, skipped: [], claimed_now: 1 });
    render(<Presales products={PRODUCTS} />);
    const select = screen.getByLabelText("Song or release") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choose…", "MIZULS single (release)"]);
    fireEvent.change(select, { target: { value: "p1" } });

    fireEvent.change(screen.getByLabelText(/Paste the list/), {
      target: { value: "Name,Phone,Email,Amount\nNadia,01711111111,nadia@example.com,250\nKarim,01822222222,karim@example.com,300" },
    });
    expect(screen.getByText(/Ready to add/).textContent).toContain("2");
    fireEvent.click(screen.getByRole("button", { name: "Add 2 buyers" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("1 already had an account"));
    const [productId, rows] = api.uploadPresales.mock.calls[0];
    expect(productId).toBe("p1");
    expect(rows).toEqual([
      { email: "nadia@example.com", buyer_name: "Nadia", amount_minor: 25000, paid_on: null },
      { email: "karim@example.com", buyer_name: "Karim", amount_minor: 30000, paid_on: null },
    ]);
    expect(JSON.stringify(rows)).not.toContain("0171");
  });

  it("shows who has the song, the totals, and removes a waiting row", async () => {
    api.cancelPresale.mockResolvedValue({});
    render(<Presales products={PRODUCTS} />);
    fireEvent.change(screen.getByLabelText("Song or release"), { target: { value: "p1" } });
    expect(await screen.findByText("Has the song")).toBeTruthy();
    expect(screen.getByText("Waiting for sign-up")).toBeTruthy();
    expect(screen.getByText(/of/, { selector: "p" }).textContent).toMatch(/1\s*of\s*2 buyers have the song/);
    // Only the waiting row can be removed.
    const remove = screen.getAllByRole("button", { name: "Remove" });
    expect(remove).toHaveLength(1);
    fireEvent.click(remove[0]);
    await waitFor(() => expect(api.cancelPresale).toHaveBeenCalledWith("s2"));
  });
});
