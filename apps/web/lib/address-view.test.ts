import { describe, expect, it } from "vitest";

import type { DeliveryAddress } from "@/features/identity/api";

import { addressLines, displayMobile, displayPhone, draftFrom, EMPTY_ADDRESS, missingFields, nationalNumber, toPayload, withCountry } from "./address-view";

const SAVED: DeliveryAddress = {
  country_code: "BD",
  recipient_name: "Nadia Rahman",
  phone: "+8801712345678",
  address_line1: "House 12, Road 27, Dhanmondi",
  city: "Dhaka",
  region: "Dhaka",
  postcode: "1209",
  updated_at: "2026-10-18T10:00:00Z",
};

const UK: DeliveryAddress = {
  country_code: "GB",
  recipient_name: "Nadia Rahman",
  phone_country: "GB",
  phone: "+447700900123",
  address_line1: "Flat 3, 12 Brick Lane",
  city: "London",
  region: null,
  postcode: "E1 6RA",
};

describe("address view", () => {
  it("shows a saved mobile the way people write it", () => {
    expect(displayMobile("+8801712345678")).toBe("01712 345678");
    expect(displayMobile("not a number")).toBe("not a number");
    expect(draftFrom(SAVED).phone).toBe("01712 345678");
    expect(draftFrom(null)).toEqual(EMPTY_ADDRESS);
  });

  it("asks the same fields for every country (D-ADDR-03)", () => {
    expect(missingFields(EMPTY_ADDRESS)).toEqual(["recipient_name", "phone", "address_line1", "city"]);
    expect(missingFields({ ...EMPTY_ADDRESS, country_code: "GB" })).toEqual(["recipient_name", "phone", "address_line1", "city"]);
    expect(missingFields(draftFrom(SAVED))).toEqual([]);
    expect(missingFields({ ...draftFrom(UK), city: " " })).toEqual(["city"]);
  });

  it("keeps only the form's fields from what the API sends", () => {
    const older = { ...SAVED, upazila: "Dhanmondi", landmark: "Lake" } as DeliveryAddress;
    expect(Object.keys(draftFrom(older)).sort()).toEqual(Object.keys(EMPTY_ADDRESS).sort());
  });

  it("sends empty optional fields as null", () => {
    expect(toPayload({ ...draftFrom(SAVED), postcode: "  ", region: " Dhaka " })).toMatchObject({ postcode: null, region: "Dhaka" });
  });

  it("prints the address as lines", () => {
    expect(addressLines(SAVED)).toEqual(["Nadia Rahman · 01712 345678", "House 12, Road 27, Dhanmondi", "Dhaka, Dhaka, 1209"]);
    const name = (code: string) => (code === "GB" ? "United Kingdom" : undefined);
    expect(addressLines(UK, name)).toEqual(["Nadia Rahman · +447700900123", "Flat 3, 12 Brick Lane", "London, E1 6RA", "United Kingdom"]);
  });

  it("shows phone numbers abroad without their calling code for editing", () => {
    expect(draftFrom(UK, [{ code: "GB", name: "United Kingdom", calling_code: "44" }]).phone).toBe("7700900123");
    expect(nationalNumber("+447700900123", "GB", [])).toBe("+447700900123");
    expect(displayPhone("+8801712345678")).toBe("01712 345678");
  });

  it("moves the phone's country with the address until a number is typed", () => {
    expect(withCountry(EMPTY_ADDRESS, "GB").phone_country).toBe("GB");
    expect(withCountry({ ...EMPTY_ADDRESS, phone: "01712345678" }, "GB").phone_country).toBe("BD");
  });
});
