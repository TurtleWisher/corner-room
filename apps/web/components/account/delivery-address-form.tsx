"use client";

/*
 * Bangladesh delivery address for gifts (D-ADDR-01). Used on the account page and inside checkout.
 * The API validates and normalises everything (mobile format, division and district names); this
 * form only lays the fields out and points at the field the API names in an error.
 */

import { FormEvent, useState } from "react";

import { Button, Field, Input, Select } from "@/components/ds";
import { useAsync } from "@/components/use-async";
import { fetchAddressOptions, saveMyDeliveryAddress, type DeliveryAddress, type DeliveryAddressDraft } from "@/features/identity/api";
import { districtsFor, draftFrom, toPayload, withDivision } from "@/lib/address-view";
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
  const [draft, setDraft] = useState<DeliveryAddressDraft>(() => draftFrom(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: FieldName | null; message: string } | null>(null);

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

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-fg">
        A Bangladesh address where you can receive gifts at any time. If you are abroad right now, give the Bangladesh address where we should send them.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Recipient's name" required error={fieldError("recipient_name")}>
          {(c) => <Input {...c} autoComplete="name" value={draft.recipient_name} onChange={(e) => set("recipient_name", e.target.value)} maxLength={120} />}
        </Field>
        <Field label="Mobile number" required hint="Bangladesh mobile, for the courier. Like 01712 345678." error={fieldError("phone")}>
          {(c) => <Input {...c} type="tel" inputMode="tel" autoComplete="tel-national" value={draft.phone} onChange={(e) => set("phone", e.target.value)} maxLength={20} />}
        </Field>
        <Field label="Division" required error={fieldError("division")}>
          {(c) => (
            <Select {...c} value={draft.division} onChange={(e) => setDraft((d) => withDivision(d, e.target.value, opts))} disabled={!opts}>
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
            <Select {...c} value={draft.district} onChange={(e) => set("district", e.target.value)} disabled={!draft.division}>
              <option value="">{draft.division ? "Choose a district" : "Choose a division first"}</option>
              {districtsFor(opts, draft.division).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Upazila or thana" required error={fieldError("upazila")}>
          {(c) => <Input {...c} value={draft.upazila} onChange={(e) => set("upazila", e.target.value)} maxLength={80} />}
        </Field>
        <Field label="Area" required hint="Neighbourhood, union or village." error={fieldError("area")}>
          {(c) => <Input {...c} value={draft.area} onChange={(e) => set("area", e.target.value)} maxLength={120} />}
        </Field>
        <Field label="House and road" required className="sm:col-span-2" error={fieldError("house_road")}>
          {(c) => <Input {...c} autoComplete="address-line1" value={draft.house_road} onChange={(e) => set("house_road", e.target.value)} maxLength={200} />}
        </Field>
        <Field label="Postcode" hint="Optional. 4 digits." error={fieldError("postcode")}>
          {(c) => <Input {...c} inputMode="numeric" autoComplete="postal-code" value={draft.postcode ?? ""} onChange={(e) => set("postcode", e.target.value)} maxLength={4} />}
        </Field>
        <Field label="Landmark" hint="Optional. Something nearby that helps the courier." error={fieldError("landmark")}>
          {(c) => <Input {...c} value={draft.landmark ?? ""} onChange={(e) => set("landmark", e.target.value)} maxLength={200} />}
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
