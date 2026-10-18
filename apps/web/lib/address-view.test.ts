import { describe, expect, it } from "vitest";

import type { AddressOptions, DeliveryAddress } from "@/features/identity/api";

import { addressLines, displayMobile, districtsFor, draftFrom, EMPTY_ADDRESS, missingFields, toPayload, withDivision } from "./address-view";

const OPTIONS: AddressOptions = {
  country: "Bangladesh",
  divisions: [
    { name: "Dhaka", districts: ["Dhaka", "Gazipur"] },
    { name: "Sylhet", districts: ["Sylhet", "Sunamganj"] },
  ],
};

const SAVED: DeliveryAddress = {
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
});
