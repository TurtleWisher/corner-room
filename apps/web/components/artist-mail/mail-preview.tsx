/* How an artist email reads in a buyer's inbox (D-MAIL-01). The server writes the real one; this
 * mirrors its fill-ins and footer so the writer sees what goes out. */

import { CircleAlert } from "lucide-react";

import { previewFill, unknownFillIns } from "@/lib/artist-mail-view";

const SAMPLE = { buyer_name: "[buyer's name]", music: "[the music they bought]" };

export function MailPreview({
  artist,
  subject,
  body,
  kind,
  music,
}: {
  artist: string;
  subject: string;
  body: string;
  kind: "THANK_YOU" | "MANUAL";
  music?: string;
}) {
  const values = { ...SAMPLE, artist, ...(music ? { music } : {}) };
  const unknown = unknownFillIns(`${subject} ${body}`);
  return (
    <figure className="grid content-start gap-2">
      <figcaption className="text-[0.8125rem] font-semibold text-fg">Preview</figcaption>
      <div className="rounded border border-line bg-surface-overlay p-4 text-sm">
        <p className="text-fg-muted">
          From: <span className="text-fg">{artist} via Corner Room</span>
        </p>
        <p className="mt-1 font-semibold text-fg">{previewFill(subject, values) || "No subject yet"}</p>
        <div className="mt-3 whitespace-pre-wrap break-words text-fg">{previewFill(body, values) || "Nothing written yet"}</div>
        <div className="mt-4 border-t border-line pt-2 text-xs text-fg-muted">
          {kind === "THANK_YOU" ? (
            <p>Sent by Corner Room for {artist}. Replies to this email aren&apos;t read. Your music on Corner Room: a link to their purchases.</p>
          ) : (
            <p>
              You&apos;re getting this because you bought music from {artist} on Corner Room. Replies to this email aren&apos;t read. Stop emails
              from {artist}: a one-click link.
            </p>
          )}
        </div>
      </div>
      {unknown.length ? (
        <p className="flex items-start gap-2 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {unknown.join(", ")} {unknown.length === 1 ? "isn't a fill-in, so it" : "aren't fill-ins, so they"} will show as written.
        </p>
      ) : null}
    </figure>
  );
}
