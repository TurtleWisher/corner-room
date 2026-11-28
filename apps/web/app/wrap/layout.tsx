import type { Metadata } from "next";

/* Corner Room Wrap (owner, 2026-11-28, D-WRAP-01): a full-screen story with its own way out, so it
 * sits outside the site's shells (the one player still plays above it, from the app shell). */
export const metadata: Metadata = {
  title: "Your Corner Room Wrap",
  description: "Your songs, acts, nights out and gifts on Corner Room, told as a story you can share.",
};

export default function WrapLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" data-module="wrap" className="wr-main">
      {children}
    </main>
  );
}
