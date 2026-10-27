import { describe, expect, it } from "vitest";

import type { AddressOptions, DeliveryAddress } from "@/features/identity/api";

import {
  addressLines,
  displayMobile,
  displayPhone,
  districtsFor,
  draftFrom,
  EMPTY_ADDRESS,
  missingFields,
  nationalNumber,
  toPayload,
  withCountry,
  withDivision,
} from "./address-view";

const OPTIONS: AddressOptions = {
  country: "Bangladesh",
  divisions: [
    { name: "Dhaka", districts: ["Dhaka", "Gazipur"] },
    { name: "Sylhet", districts: ["Sylhet", "Sunamganj"] },
  ],
};

const SAVED: DeliveryAddress = {
  country_code: "BD",
  recipient_name: "Nadia Rahman",
  phone: "+8801712345678",
  division: "Dhaka",
  district: "Dhaka",
  upazila: "Dhanmondi",
  area: "Road 27",
  house_road: "House 12",
  postcode: "1209",
  landmark: null,
  updated_at: "2026-10-18T10:00:00Z",
};

describe("address view", () => {
  it("shows a saved mobile the way people write it", () => {
    expect(displayMobile("+8801712345678")).toBe("01712 345678");
    expect(displayMobile("not a number")).toBe("not a number");
    expect(draftFrom(SAVED).phone).toBe("01712 345678");
    expect(draftFrom(null)).toEqual(EMPTY_ADDRESS);
  });

  it("lists districts for the chosen division and clears one that no longer fits", () => {
    expect(districtsFor(OPTIONS, "Sylhet")).toEqual(["Sylhet", "Sunamganj"]);
    expect(districtsFor(OPTIONS, "")).toEqual([]);
    const draft = { ...EMPTY_ADDRESS, division: "Dhaka", district: "Gazipur" };
    expect(withDivision(draft, "Sylhet", OPTIONS).district).toBe("");
    expect(withDivision(draft, "Dhaka", OPTIONS).district).toBe("Gazipur");
  });

  it("names the required fields still empty", () => {
    expect(missingFields(EMPTY_ADDRESS)).toEqual(["recipient_name", "phone", "division", "district", "upazila", "area", "house_road"]);
    expect(missingFields(draftFrom(SAVED))).toEqual([]);
  });

  it("sends empty optional fields as null", () => {
    expect(toPayload({ ...draftFrom(SAVED), postcode: "  ", landmark: " Lake " })).toMatchObject({ postcode: null, landmark: "Lake" });
  });

  it("prints the address as lines", () => {
    expect(addressLines(SAVED)).toEqual(["Nadia Rahman · 01712 345678", "House 12", "Road 27", "Dhanmondi, Dhaka", "Dhaka division 1209"]);
  });

  it("lays out an address abroad (D-ADDR-02)", () => {
    const uk: DeliveryAddress = {
      country_code: "GB",
      recipient_name: "Nadia Rahman",
      phone_country: "GB",
      phone: "+447700900123",
      division: null,
      district: null,
      upazila: null,
      area: null,
      house_road: null,
      address_line1: "12 Brick Lane",
      address_line2: "Flat 3",
      city: "London",
      region: null,
      postcode: "E1 6RA",
      landmark: null,
    };
    const name = (code: string) => (code === "GB" ? "United Kingdom" : undefined);
    expect(addressLines(uk, name)).toEqual(["Nadia Rahman · +447700900123", "12 Brick Lane", "Flat 3", "London, E1 6RA", "United Kingdom"]);
    expect(missingFields({ ...draftFrom(uk), city: " " })).toEqual(["city"]);
    expect(draftFrom(uk, [{ code: "GB", name: "United Kingdom", calling_code: "44" }]).phone).toBe("7700900123");
    expect(nationalNumber("+447700900123", "GB", [])).toBe("+447700900123");
    expect(displayPhone("+8801712345678")).toBe("01712 345678");
    // Only the chosen country's fields are sent.
    expect(toPayload({ ...draftFrom(uk), division: "Dhaka" })).toMatchObject({ division: null, city: "London", address_line2: "Flat 3" });
    expect(toPayload(draftFrom(SAVED))).toMatchObject({ address_line1: null, city: null, division: "Dhaka" });
  });

  it("moves the phone's country with the address until a number is typed", () => {
    expect(withCountry(EMPTY_ADDRESS, "GB").phone_country).toBe("GB");
    expect(withCountry({ ...EMPTY_ADDRESS, phone: "01712345678" }, "GB").phone_country).toBe("BD");
  });
});
