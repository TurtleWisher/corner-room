"use client";

/* One click from an artist's email to buyers (owner, 2026-11-02, D-MAIL-01): no sign-in, the link is
 * the proof. Opening the page stops that artist's emails; thank-you emails for a purchase still come.
 * The stop is sent from the page, so mail scanners that only fetch links don't trigger it. */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CircleAlert, MailX } from "lucide-react";

import { stopEmailsByLink } from "@/features/artist-mail/api";

type State = { status: "working" } | { status: "done"; artist: string } | { status: "error" };

export default function EmailStopPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ status: "working" });

  useEffect(() => {
    let live = true;
    stopEmailsByLink(token)
      .then((r) => live && setState({ status: "done", artist: r.artist }))
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
  }, [token]);

  return (
    <main id="main" data-theme="ember" className="cr-scope">
      <div className="mx-auto max-w-xl px-4 py-16 md:px-6 md:py-24" aria-live="polite">
        {state.status === "working" ? (
          <p className="text-fg-muted">Stopping these emails</p>
        ) : state.status === "done" ? (
          <>
            <MailX aria-hidden="true" className="size-8 text-highlight" />
            <h1 className="mt-4 text-3xl font-bold text-fg">You won&apos;t get emails from {state.artist} any more</h1>
            <p className="mt-4 text-fg">
              Thank-you emails for something you buy still come, because they are part of the purchase. Changed your mind? Turn them back on from{" "}
              <Link href="/account" className="cr-focus font-semibold text-link underline">
                your account
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <CircleAlert aria-hidden="true" className="size-8 text-danger" />
            <h1 className="mt-4 text-3xl font-bold text-fg">This link didn&apos;t work</h1>
            <p className="mt-4 text-fg">
              Try the link in the email again, or stop an artist&apos;s emails from{" "}
              <Link href="/account" className="cr-focus font-semibold text-link underline">
                your account
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </main>
  );
}
