/*
 * Delivery address helpers (D-ADDR-01; anywhere in the world since D-ADDR-02; one simple shape for
 * every country since D-ADDR-03). Display and form shaping only; the API validates and normalises
 * every address (phone format, country, postcode).
 */

import type { AddressCountry, DeliveryAddress, DeliveryAddressDraft } from "@/features/identity/api";

export const EMPTY_ADDRESS: DeliveryAddressDraft = {
  country_code: "BD",
  recipient_name: "",
  phone_country: "BD",
  phone: "",
  address_line1: "",
  city: "",
  region: null,
  postcode: null,
};

/** Form values from a saved address (or empty), with the phone shown without its country code. */
export function draftFrom(address: DeliveryAddress | null, countries: AddressCountry[] = []): DeliveryAddressDraft {
  if (!address) return { ...EMPTY_ADDRESS };
  const { updated_at: _ignored, ...rest } = address;
  void _ignored;
  const phoneCountry = rest.phone_country ?? (rest.phone.startsWith("+880") ? "BD" : rest.country_code ?? "BD");
  const draft: DeliveryAddressDraft = { ...EMPTY_ADDRESS };
  // Only the form's own fields, so anything else the API sends is not sent back.
  for (const key of Object.keys(EMPTY_ADDRESS) as Array<keyof DeliveryAddressDraft>) {
    const value = rest[key];
    if (value !== null && value !== undefined) (draft as Record<string, string | null>)[key] = value;
  }
  return {
    ...draft,
    country_code: rest.country_code ?? "BD",
    phone_country: phoneCountry,
    phone: nationalNumber(rest.phone, phoneCountry, countries),
  };
}

/** "+8801712345678" -> "01712 345678". Anything else is returned as given. */
export function displayMobile(phone: string): string {
  const m = /^\+880(1\d{3})(\d{6})$/.exec(phone);
  return m ? `0${m[1]} ${m[2]}` : phone;
}

/** A stored number as people write it: Bangladesh mobiles locally, others with their + code. */
export function displayPhone(phone: string): string {
  if (phone.startsWith("+880")) return displayMobile(phone);
  return phone;
}

/** The number without its calling code, for editing next to the country picker. */
export function nationalNumber(phone: string, phoneCountry: string, countries: AddressCountry[]): string {
  if (phone.startsWith("+880")) return displayMobile(phone);
  const dial = countries.find((c) => c.code === phoneCountry)?.calling_code;
  if (dial && phone.startsWith(`+${dial}`)) return phone.slice(dial.length + 1);
  return phone;
}

/** Choosing a country also moves the phone's country along, unless a number is already typed. */
export function withCountry(draft: DeliveryAddressDraft, country: string): DeliveryAddressDraft {
  return { ...draft, country_code: country, phone_country: draft.phone.trim() ? draft.phone_country : country };
}

/** Required fields still empty, in form order (for a hint before sending; the API decides). */
export function missingFields(draft: DeliveryAddressDraft): Array<keyof DeliveryAddressDraft> {
  const required: Array<keyof DeliveryAddressDraft> = ["recipient_name", "phone", "address_line1", "city"];
  return required.filter((field) => !String(draft[field] ?? "").trim());
}

/** Empty optional fields go to the API as null. */
export function toPayload(draft: DeliveryAddressDraft): DeliveryAddressDraft {
  const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return { ...draft, region: blank(draft.region), postcode: blank(draft.postcode) };
}

/** "GB" -> "United Kingdom", from the browser's own country names; the code if it has none. */
function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

type Printable = Pick<DeliveryAddress, "recipient_name" | "phone" | "address_line1" | "city" | "region" | "postcode"> &
  Partial<Pick<DeliveryAddress, "country_code">>;

/** The address as lines for a summary card. `countryName` names a country outside Bangladesh. */
export function addressLines(address: Printable, countryName?: (code: string) => string | undefined): string[] {
  const country = address.country_code ?? "BD";
  return [
    `${address.recipient_name} · ${displayPhone(address.phone)}`,
    address.address_line1 ?? "",
    [address.city, address.region, address.postcode].filter(Boolean).join(", "),
    country === "BD" ? "" : (countryName?.(country) ?? regionName(country)),
  ].filter((line) => line.trim().length > 0);
}
