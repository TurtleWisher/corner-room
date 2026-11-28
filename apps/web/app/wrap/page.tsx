"use client";

/* Corner Room Wrap (owner, 2026-11-28, D-WRAP-01): the Wraps open now, as tickets to a fairground
 * ride. Guests are asked to sign in; staff also see drafts and Wraps not open yet, marked. */

import { Ticket } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/components/auth-provider";
import { useAsync } from "@/components/use-async";
import { WrapGate } from "@/components/wrap/wrap-gate";
import { fetchWraps } from "@/features/wraps/api";
import { friendlyError } from "@/lib/error-copy";

function period(starts: string, ends: string): string {
  const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${f(starts)} to ${f(ends)}`;
}

export default function WrapListPage() {
  const auth = useAuth();
  const list = useAsync(() => fetchWraps(), [auth.status]);
  if (auth.status === "loading" || list.status === "loading") return <WrapGate title="Finding your Wrap" busy />;
  if (list.status === "error") return <WrapGate title="Wraps couldn't load" body={friendlyError(list.error, "Please try again in a moment.")} />;
  const items = list.data;
  if (!items.length) {
    return (
      <WrapGate title="No Wrap is open right now" body="When Corner Room opens a Wrap, yours is made from everything you played, bought and went to. Keep listening.">
        <Link href="/listen" className="wr-pill">
          Go listen
        </Link>
      </WrapGate>
    );
  }
  const signedIn = auth.status === "authenticated";
  return (
    <WrapGate title={items.length === 1 ? items[0].tagline : "Your Corner Room Wraps"} body={signedIn ? "Made from your own listening. Only you see it, until you share it." : "Sign in to open yours. It's made from your own listening."}>
      <ul className="wr-tickets">
        {items.map((w) => (
          <li key={w.id}>
            <Link href={signedIn ? `/wrap/${w.id}${w.staff_only ? "?preview=1" : ""}` : `/login?next=${encodeURIComponent(`/wrap/${w.id}`)}`} className="wr-ticket-link">
              <Ticket aria-hidden className="size-5" />
              <span className="wr-ticket-text">
                <span className="wr-ticket-name">{w.name}</span>
                <span className="wr-ticket-when">{period(w.starts_on, w.ends_on)}</span>
              </span>
              {w.staff_only ? <span className="wr-badge">Staff only</span> : <span className="wr-ticket-go">{signedIn ? "Open" : "Sign in"}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </WrapGate>
  );
}
