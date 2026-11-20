"use client";

/*
 * Shows a gift email the server wrote, inside the page (D-GIFT-FAN-02). The site's security rules
 * allow no frames (frame-src 'none', frozen), so the email's body is drawn in a box instead. It is
 * safe to draw: the server escapes every word the giver typed and only keeps https links; pictures
 * arrive as `cid:file-<id>` and become this page's own copies. Links can't be pressed here.
 */

import { emailBody, withPictures } from "@/lib/fan-gift-view";

export function EmailFrame({ html, pictures, className }: { html: string; pictures: Record<string, string>; className?: string }) {
  return (
    <div
      className={`max-h-[34rem] overflow-y-auto border border-line [&_a]:pointer-events-none ${className ?? ""}`}
      // Server-written email, every typed word escaped there (fan_gift_email.py).
      dangerouslySetInnerHTML={{ __html: withPictures(emailBody(html), pictures) }}
    />
  );
}
