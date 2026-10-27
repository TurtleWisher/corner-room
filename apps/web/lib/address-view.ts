/*
 * Delivery address helpers (D-ADDR-01; anywhere in the world since D-ADDR-02). Display and form
 * shaping only; the API validates and normalises every address (phone format, country, Bangladesh
 * division and district names).
 */

import type { AddressCountry, AddressOptions, DeliveryAddress, DeliveryAddressDraft } from "@/features/identity/api";

export const EMPTY_ADDRESS: DeliveryAddressDraft = {
  country_code: "BD",
  recipient_name: "",
  phone_country: "BD",
  phone: "",
  division: "",
  district: "",
  upazila: "",
  area: "",
  house_road: "",
  address_line1: "",
  address_line2: null,
  city: "",
  region: null,
  postcode: null,
  landmark: null,
};

/** Form values from a saved address (or empty), with the phone shown without its country code. */
export function draftFrom(address: DeliveryAddress | null, countries: AddressCountry[] = []): DeliveryAddressDraft {
  if (!address) return { ...EMPTY_ADDRESS };
  const { updated_at: _ignored, ...rest } = address;
  void _ignored;
  const phoneCountry = rest.phone_country ?? (rest.phone.startsWith("+880") ? "BD" : rest.country_code ?? "BD");
  const draft: DeliveryAddressDraft = { ...EMPTY_ADDRESS };
  for (const [key, value] of Object.entries(rest) as Array<[keyof DeliveryAddressDraft, string | null]>) {
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

export function isBangladesh(draft: Pick<DeliveryAddressDraft, "country_code">): boolean {
  return (draft.country_code || "BD") === "BD";
}

export function districtsFor(options: AddressOptions | null, division: string): string[] {
  return options?.divisions.find((d) => d.name === division)?.districts ?? [];
}

/** Changing the division clears a district that does not belong to it. */
export function withDivision(draft: DeliveryAddressDraft, division: string, options: AddressOptions | null): DeliveryAddressDraft {
  const keep = districtsFor(options, division).includes(draft.district ?? "");
  return { ...draft, division, district: keep ? draft.district : "" };
}

/** Choosing a country also moves the phone's country along, unless a number is already typed. */
export function withCountry(draft: DeliveryAddressDraft, country: string): DeliveryAddressDraft {
  return { ...draft, country_code: country, phone_country: draft.phone.trim() ? draft.phone_country : country };
}

/** Required fields still empty, in form order (for a hint before sending; the API decides). */
export function missingFields(draft: DeliveryAddressDraft): Array<keyof DeliveryAddressDraft> {
  const required: Array<keyof DeliveryAddressDraft> = isBangladesh(draft)
    ? ["recipient_name", "phone", "division", "district", "upazila", "area", "house_road"]
    : ["recipient_name", "phone", "address_line1", "city"];
  return required.filter((field) => !String(draft[field] ?? "").trim());
}

/** Only the fields of the chosen country's shape; empty optional fields go to the API as null. */
export function toPayload(draft: DeliveryAddressDraft): DeliveryAddressDraft {
  const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const bd = isBangladesh(draft);
  return {
    ...draft,
    division: bd ? draft.division : null,
    district: bd ? draft.district : null,
    upazila: bd ? draft.upazila : null,
    area: bd ? draft.area : null,
    house_road: bd ? draft.house_road : null,
    address_line1: bd ? null : draft.address_line1,
    address_line2: bd ? null : blank(draft.address_line2),
    city: bd ? null : draft.city,
    region: bd ? null : blank(draft.region),
    postcode: blank(draft.postcode),
    landmark: blank(draft.landmark),
  };
}

/** "GB" -> "United Kingdom", from the browser's own country names; the code if it has none. */
function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

type Printable = Pick<
  DeliveryAddress,
  "recipient_name" | "phone" | "house_road" | "area" | "upazila" | "district" | "division" | "postcode" | "landmark"
> &
  Partial<Pick<DeliveryAddress, "country_code" | "address_line1" | "address_line2" | "city" | "region">>;

/** The address as lines for a summary card. `countryName` names a country outside Bangladesh. */
export function addressLines(address: Printable, countryName?: (code: string) => string | undefined): string[] {
  const country = address.country_code ?? "BD";
  const landmark = address.landmark ? `Near ${address.landmark}` : "";
  if (country !== "BD") {
    return [
      `${address.recipient_name} · ${displayPhone(address.phone)}`,
      address.address_line1 ?? "",
      address.address_line2 ?? "",
      [address.city, address.region, address.postcode].filter(Boolean).join(", "),
      countryName?.(country) ?? regionName(country),
      landmark,
    ].filter((line) => line.trim().length > 0);
  }
  const place = [address.upazila, address.district].filter(Boolean).join(", ");
  const region = [address.division ? `${address.division} division` : "", address.postcode ?? ""].filter(Boolean).join(" ");
  return [`${address.recipient_name} · ${displayMobile(address.phone)}`, address.house_road ?? "", address.area ?? "", place, region, landmark].filter(
    (line) => line.trim().length > 0,
  );
}
