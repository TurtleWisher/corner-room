/*
 * Delivery address helpers (D-ADDR-01). Display and form shaping only; the API validates and
 * normalises every address (mobile number format, division and district names).
 */

import type { AddressOptions, DeliveryAddress, DeliveryAddressDraft } from "@/features/identity/api";

export const EMPTY_ADDRESS: DeliveryAddressDraft = {
  recipient_name: "",
  phone: "",
  division: "",
  district: "",
  upazila: "",
  area: "",
  house_road: "",
  postcode: null,
  landmark: null,
};

/** Form values from a saved address (or empty), with the mobile shown the way people write it. */
export function draftFrom(address: DeliveryAddress | null): DeliveryAddressDraft {
  if (!address) return { ...EMPTY_ADDRESS };
  const { updated_at: _ignored, ...rest } = address;
  void _ignored;
  return { ...rest, phone: displayMobile(rest.phone) };
}

/** "+8801712345678" -> "01712 345678". Anything else is returned as given. */
export function displayMobile(phone: string): string {
  const m = /^\+880(1\d{3})(\d{6})$/.exec(phone);
  return m ? `0${m[1]} ${m[2]}` : phone;
}

export function districtsFor(options: AddressOptions | null, division: string): string[] {
  return options?.divisions.find((d) => d.name === division)?.districts ?? [];
}

/** Changing the division clears a district that does not belong to it. */
export function withDivision(draft: DeliveryAddressDraft, division: string, options: AddressOptions | null): DeliveryAddressDraft {
  const keep = districtsFor(options, division).includes(draft.district);
  return { ...draft, division, district: keep ? draft.district : "" };
}

/** Required fields still empty, in form order (for a hint before sending; the API decides). */
export function missingFields(draft: DeliveryAddressDraft): Array<keyof DeliveryAddressDraft> {
  const required: Array<keyof DeliveryAddressDraft> = ["recipient_name", "phone", "division", "district", "upazila", "area", "house_road"];
  return required.filter((field) => !String(draft[field] ?? "").trim());
}

/** Empty optional fields go to the API as null. */
export function toPayload(draft: DeliveryAddressDraft): DeliveryAddressDraft {
  const blank = (v: string | null) => (v && v.trim() ? v.trim() : null);
  return { ...draft, postcode: blank(draft.postcode), landmark: blank(draft.landmark) };
}

/** The address as lines for a summary card. */
export function addressLines(address: Pick<DeliveryAddress, "recipient_name" | "phone" | "house_road" | "area" | "upazila" | "district" | "division" | "postcode" | "landmark">): string[] {
  const place = [address.upazila, address.district].filter(Boolean).join(", ");
  const region = [address.division ? `${address.division} division` : "", address.postcode ?? ""].filter(Boolean).join(" ");
  return [
    `${address.recipient_name} · ${displayMobile(address.phone)}`,
    address.house_road,
    address.area,
    place,
    region,
    address.landmark ? `Near ${address.landmark}` : "",
  ].filter((line) => line.trim().length > 0);
}
