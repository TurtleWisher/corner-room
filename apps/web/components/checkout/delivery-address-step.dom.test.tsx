// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeliveryAddress } from "@/features/identity/api";

const api = { fetchAddressOptions: vi.fn(), fetchMyDeliveryAddress: vi.fn(), saveMyDeliveryAddress: vi.fn() };
vi.mock("@/features/identity/api", () => ({
  fetchAddressOptions: () => api.fetchAddressOptions(),
  fetchMyDeliveryAddress: () => api.fetchMyDeliveryAddress(),
  saveMyDeliveryAddress: (a: unknown) => api.saveMyDeliveryAddress(a),
}));

import { DeliveryAddressStep } from "./delivery-address-step";

const SAVED: DeliveryAddress = {
  country_code: "BD",
  recipient_name: "Nadia Rahman",
  phone: "+8801712345678",
  address_line1: "House 12, Road 27, Dhanmondi",
  city: "Dhaka",
  region: "Dhaka",
  postcode: null,
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchAddressOptions.mockResolvedValue({
    country: "Bangladesh",
    divisions: [
      { name: "Dhaka", districts: ["Dhaka", "Gazipur"] },
      { name: "Sylhet", districts: ["Sylhet"] },
    ],
    countries: [
      { code: "BD", name: "Bangladesh", calling_code: "880" },
      { code: "GB", name: "United Kingdom", calling_code: "44" },
    ],
  });
});
afterEach(cleanup);

describe("DeliveryAddressStep", () => {
  it("shows the saved address and asks to confirm it for this order", async () => {
    api.fetchMyDeliveryAddress.mockResolvedValue(SAVED);
    const onChange = vi.fn();
    render(<DeliveryAddressStep confirmed={false} onConfirmedChange={onChange} />);
    expect(await screen.findByText("Nadia Rahman · 01712 345678")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Send any gifts for this order to this address/ }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("asks for an address when there is none, and saving it confirms the order", async () => {
    api.fetchMyDeliveryAddress.mockResolvedValue(null);
    api.saveMyDeliveryAddress.mockResolvedValue(SAVED);
    const onChange = vi.fn();
    render(<DeliveryAddressStep confirmed={false} onConfirmedChange={onChange} />);
    const name = await screen.findByLabelText(/Recipient's name/);
    fireEvent.change(name, { target: { value: "Nadia Rahman" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Phone number/ }), { target: { value: "01712 345678" } });
    // One simple shape: no Area, upazila or house/road boxes (D-ADDR-03).
    expect(screen.queryByLabelText(/^Area/)).toBeNull();
    expect(screen.queryByLabelText(/Upazila/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Detailed address/), { target: { value: "House 12, Road 27, Dhanmondi" } });
    fireEvent.change(screen.getByLabelText(/District or city/), { target: { value: "Dhaka" } });
    fireEvent.change(screen.getByLabelText(/Division, state or region/), { target: { value: "Dhaka" } });
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(api.saveMyDeliveryAddress).toHaveBeenCalledTimes(1));
    expect(api.saveMyDeliveryAddress.mock.calls[0][0]).toEqual({
      country_code: "BD",
      recipient_name: "Nadia Rahman",
      phone_country: "BD",
      phone: "01712 345678",
      address_line1: "House 12, Road 27, Dhanmondi",
      city: "Dhaka",
      region: "Dhaka",
      postcode: null,
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
    expect(await screen.findByText("Nadia Rahman · 01712 345678")).toBeTruthy();
  });

  it("takes an address abroad with the same fields (D-ADDR-02, D-ADDR-03)", async () => {
    api.fetchMyDeliveryAddress.mockResolvedValue(null);
    api.saveMyDeliveryAddress.mockImplementation(async (a: DeliveryAddress) => ({ ...a, phone: "+447700900123" }));
    render(<DeliveryAddressStep confirmed={false} onConfirmedChange={() => {}} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "United Kingdom" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/^Country/), { target: { value: "GB" } });
    expect((screen.getByLabelText("Phone number's country") as HTMLSelectElement).value).toBe("GB");
    fireEvent.change(screen.getByLabelText(/Recipient's name/), { target: { value: "Nadia Rahman" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Phone number/ }), { target: { value: "07700 900123" } });
    fireEvent.change(screen.getByLabelText(/Detailed address/), { target: { value: "12 Brick Lane" } });
    fireEvent.change(screen.getByLabelText(/District or city/), { target: { value: "London" } });
    fireEvent.change(screen.getByLabelText(/Postcode/), { target: { value: "E1 6RA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(api.saveMyDeliveryAddress).toHaveBeenCalledTimes(1));
    expect(api.saveMyDeliveryAddress.mock.calls[0][0]).toMatchObject({
      country_code: "GB",
      phone_country: "GB",
      address_line1: "12 Brick Lane",
      city: "London",
      region: null,
      postcode: "E1 6RA",
    });
  });

  it("points at the field the server names in an error", async () => {
    const { ApiError } = await import("@/lib/api/client");
    api.fetchMyDeliveryAddress.mockResolvedValue(null);
    api.saveMyDeliveryAddress.mockRejectedValue(
      new ApiError({ status: 422, code: "VALIDATION_ERROR", title: "x", detail: "Enter a Bangladesh mobile number, like 01712 345678", field: "phone" } as never),
    );
    render(<DeliveryAddressStep confirmed={false} onConfirmedChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save address" }));
    const phone = await screen.findByRole("textbox", { name: /Phone number/ });
    await waitFor(() => expect(phone.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("Enter a Bangladesh mobile number, like 01712 345678")).toBeTruthy();
  });

  it("changing the address un-confirms until it is saved again", async () => {
    api.fetchMyDeliveryAddress.mockResolvedValue(SAVED);
    const onChange = vi.fn();
    render(<DeliveryAddressStep confirmed onConfirmedChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: /Change/ }));
    expect(onChange).toHaveBeenCalledWith(false);
    expect(await screen.findByRole("button", { name: "Save and use this address" })).toBeTruthy();
  });
});
