"use client";

/*
 * Delivery address for gifts (D-ADDR-01), anywhere in the world (owner, 2026-10-27, D-ADDR-02).
 * Used on the account page and inside checkout. A Bangladesh address keeps its division and
 * district lists; elsewhere it is the usual international layout. The phone has its own country
 * picker, so a buyer abroad can give a Bangladesh address and number, or the other way round.
 * The API validates and normalises everything; this form lays the fields out and points at the
 * field the API names in an error.
 */

import { FormEvent, useEffect, useRef, useState } from "react";

import { Button, Field, Input, Select } from "@/components/ds";
import { useAsync } from "@/components/use-async";
import { fetchAddressOptions, saveMyDeliveryAddress, type DeliveryAddress, type DeliveryAddressDraft } from "@/features/identity/api";
import { districtsFor, draftFrom, isBangladesh, toPayload, withCountry, withDivision } from "@/lib/address-view";
import { ApiError } from "@/lib/api/client";

type FieldName = keyof DeliveryAddressDraft;

export function DeliveryAddressForm({
  initial,
  onSaved,
  onCancel,
  submitLabel = "Save address",
}: {
  initial: DeliveryAddress | null;
  onSaved: (address: DeliveryAddress) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const options = useAsync(fetchAddressOptions, []);
  const opts = options.status === "ok" ? options.data : null;
  const countries = opts?.countries ?? [{ code: "BD", name: "Bangladesh", calling_code: "880" }];
  const [draft, setDraft] = useState<DeliveryAddressDraft>(() => draftFrom(initial));
  // Saved numbers are shown without their calling code once the country list has loaded.
  const loadedCountries = opts?.countries;
  const shaped = useRef(false);
  useEffect(() => {
    if (shaped.current || !loadedCountries || !initial) return;
    shaped.current = true;
    setDraft((d) => ({ ...d, phone: draftFrom(initial, loadedCountries).phone }));
  }, [loadedCountries, initial]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: FieldName | null; message: string } | null>(null);
  const bd = isBangladesh(draft);
  const phoneBd = (draft.phone_country || draft.country_code) === "BD";

  function set(field: FieldName, value: string) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (error?.field === field) setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveMyDeliveryAddress(toPayload(draft)));
    } catch (err) {
      if (err instanceof ApiError) {
        const field = (err.problem as { field?: string } | undefined)?.field as FieldName | undefined;
        setError({ field: field ?? null, message: err.message });
      } else {
        setError({ field: null, message: "Your address could not be saved. Please try again." });
      }
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (field: FieldName) => (error?.field === field ? error.message : undefined);
  const value = (field: FieldName) => (draft[field] as string | null | undefined) ?? "";

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-fg">
        Where gifts can reach you, in Bangladesh or anywhere else. Sending a gift to someone? Give their address and number instead.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" required className="sm:col-span-2" error={fieldError("country_code")}>
          {(c) => (
            <Select {...c} autoComplete="country" value={draft.country_code} onChange={(e) => setDraft((d) => withCountry(d, e.target.value))}>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Recipient's name" required error={fieldError("recipient_name")}>
          {(c) => <Input {...c} autoComplete="name" value={draft.recipient_name} onChange={(e) => set("recipient_name", e.target.value)} maxLength={120} />}
        </Field>
        <Field
          label="Phone number"
          required
          hint={phoneBd ? "Bangladesh mobile, for the courier. Like 01712 345678." : "For the courier. Choose the number's country, then type the number."}
          error={fieldError("phone") ?? fieldError("phone_country")}
        >
          {(c) => (
            <div className="flex gap-2">
              <Select
                aria-label="Phone number's country"
                value={draft.phone_country ?? draft.country_code}
                onChange={(e) => set("phone_country", e.target.value)}
                className="w-[7.5rem] shrink-0"
              >
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.code} +{country.calling_code}
                  </option>
                ))}
              </Select>
              <Input
                {...c}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                value={draft.phone}
                onChange={(e) => set("phone", e.target.value)}
                maxLength={24}
              />
            </div>
          )}
        </Field>
        {bd ? (
          <>
            <Field label="Division" required error={fieldError("division")}>
              {(c) => (
                <Select {...c} value={value("division")} onChange={(e) => setDraft((d) => withDivision(d, e.target.value, opts))} disabled={!opts}>
                  <option value="">{opts ? "Choose a division" : "Loading"}</option>
                  {opts?.divisions.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="District" required error={fieldError("district")}>
              {(c) => (
                <Select {...c} value={value("district")} onChange={(e) => set("district", e.target.value)} disabled={!draft.division}>
                  <option value="">{draft.division ? "Choose a district" : "Choose a division first"}</option>
                  {districtsFor(opts, value("division")).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Upazila or thana" required error={fieldError("upazila")}>
              {(c) => <Input {...c} value={value("upazila")} onChange={(e) => set("upazila", e.target.value)} maxLength={80} />}
            </Field>
            <Field label="Area" required hint="Neighbourhood, union or village." error={fieldError("area")}>
              {(c) => <Input {...c} value={value("area")} onChange={(e) => set("area", e.target.value)} maxLength={120} />}
            </Field>
            <Field label="House and road" required className="sm:col-span-2" error={fieldError("house_road")}>
              {(c) => <Input {...c} autoComplete="address-line1" value={value("house_road")} onChange={(e) => set("house_road", e.target.value)} maxLength={200} />}
            </Field>
            <Field label="Postcode" hint="Optional. 4 digits." error={fieldError("postcode")}>
              {(c) => <Input {...c} inputMode="numeric" autoComplete="postal-code" value={value("postcode")} onChange={(e) => set("postcode", e.target.value)} maxLength={4} />}
            </Field>
          </>
        ) : (
          <>
            <Field label="Address" required hint="Street and number, or P.O. box." className="sm:col-span-2" error={fieldError("address_line1")}>
              {(c) => <Input {...c} autoComplete="address-line1" value={value("address_line1")} onChange={(e) => set("address_line1", e.target.value)} maxLength={200} />}
            </Field>
            <Field label="Apartment, suite, building" hint="Optional." className="sm:col-span-2" error={fieldError("address_line2")}>
              {(c) => <Input {...c} autoComplete="address-line2" value={value("address_line2")} onChange={(e) => set("address_line2", e.target.value)} maxLength={200} />}
            </Field>
            <Field label="City or town" required error={fieldError("city")}>
              {(c) => <Input {...c} autoComplete="address-level2" value={value("city")} onChange={(e) => set("city", e.target.value)} maxLength={120} />}
            </Field>
            <Field label="State, province or region" hint="If the address has one." error={fieldError("region")}>
              {(c) => <Input {...c} autoComplete="address-level1" value={value("region")} onChange={(e) => set("region", e.target.value)} maxLength={120} />}
            </Field>
            <Field label="Postal code" hint="If the address has one." error={fieldError("postcode")}>
              {(c) => <Input {...c} autoComplete="postal-code" value={value("postcode")} onChange={(e) => set("postcode", e.target.value)} maxLength={12} />}
            </Field>
          </>
        )}
        <Field label="Landmark" hint="Optional. Something nearby that helps the courier." error={fieldError("landmark")}>
          {(c) => <Input {...c} value={value("landmark")} onChange={(e) => set("landmark", e.target.value)} maxLength={200} />}
        </Field>
      </div>
      {error && !error.field ? (
        <p role="alert" className="text-sm text-danger">
          {error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" busy={busy}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
