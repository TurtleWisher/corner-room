"use client";

/* /account: emails from artists and bands you bought from (owner, 2026-11-02, D-MAIL-01). Each can be
 * stopped or restarted here, as with the link in their emails. Thank-you emails for a purchase still
 * come: they are part of the purchase. */

import { useState } from "react";

import { ErrorState, Skeleton } from "@/components/ds";
import { RetryButton } from "@/components/shell/staff-panel";
import { loadErrorMessage, useAsync } from "@/components/use-async";
import { fetchMyMailChoices, setMyMailChoice, type MailChoice } from "@/features/artist-mail/api";

export function ArtistMailChoices() {
  const loaded = useAsync(() => fetchMyMailChoices(), []);
  const [choices, setChoices] = useState<MailChoice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loaded.status === "loading") return <Skeleton className="h-16 w-full" />;
  if (loaded.status === "error") {
    return <ErrorState title="Not available" message={loadErrorMessage(loaded.error, "your email choices")} action={<RetryButton onClick={loaded.reload} />} />;
  }
  const list = choices ?? loaded.data;
  if (list.length === 0) {
    return <p className="text-sm text-fg-muted">When you buy music, the artist or band can email you news through Corner Room. You can stop them here.</p>;
  }

  async function change(c: MailChoice, receiving: boolean) {
    setBusy(`${c.kind}:${c.id}`);
    setError(null);
    try {
      setChoices(await setMyMailChoice(c.kind, c.id, receiving));
    } catch {
      setError("That didn't save. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="text-sm text-fg-muted">News from artists and bands you bought from, sent by Corner Room. Thank-you emails for a purchase always come.</p>
      <ul className="mt-3 divide-y divide-line">
        {list.map((c) => (
          <li key={`${c.kind}:${c.id}`} className="py-2">
            <label className="flex items-center justify-between gap-3 text-sm text-fg">
              <span className="font-semibold">{c.display_name}</span>
              <span className="flex items-center gap-2">
                {c.receiving ? "Emails on" : "Emails stopped"}
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`Emails from ${c.display_name}`}
                  checked={c.receiving}
                  disabled={busy === `${c.kind}:${c.id}`}
                  onChange={(e) => void change(c, e.target.checked)}
                />
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
