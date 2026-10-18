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
  recipient_name: "Nadia Rahman",
  phone: "+8801712345678",
  division: "Dhaka",
  district: "Dhaka",
  upazila: "Dhanmondi",
  area: "Road 27",
  house_road: "House 12",
  postcode: null,
  landmark: null,
};

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchAddressOptions.mockResolvedValue({
    country: "Bangladesh",
    divisions: [
      { name: "Dhaka", districts: ["Dhaka", "Gazipur"] },
      { name: "Sylhet", districts: ["Sylhet"] },
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
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: "01712 345678" } });
    await waitFor(() => expect((screen.getByLabelText(/Division/) as HTMLSelectElement).disabled).toBe(false));
    // The district list waits for a division.
    expect((screen.getByLabelText(/District/) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Division/), { target: { value: "Dhaka" } });
    fireEvent.change(screen.getByLabelText(/District/), { target: { value: "Dhaka" } });
    fireEvent.change(screen.getByLabelText(/Upazila or thana/), { target: { value: "Dhanmondi" } });
    fireEvent.change(screen.getByLabelText(/^Area/), { target: { value: "Road 27" } });
    fireEvent.change(screen.getByLabelText(/House and road/), { target: { value: "House 12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(api.saveMyDeliveryAddress).toHaveBeenCalledTimes(1));
    expect(api.saveMyDeliveryAddress.mock.calls[0][0]).toMatchObject({ division: "Dhaka", district: "Dhaka", postcode: null, landmark: null });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true));
    expect(await screen.findByText("Nadia Rahman · 01712 345678")).toBeTruthy();
  });

  it("points at the field the server names in an error", async () => {
    const { ApiError } = await import("@/lib/api/client");
    api.fetchMyDeliveryAddress.mockResolvedValue(null);
    api.saveMyDeliveryAddress.mockRejectedValue(
      new ApiError({ status: 422, code: "VALIDATION_ERROR", title: "x", detail: "Enter a Bangladesh mobile number, like 01712 345678", field: "phone" } as never),
    );
    render(<DeliveryAddressStep confirmed={false} onConfirmedChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save address" }));
    const phone = await screen.findByLabelText(/Mobile number/);
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
