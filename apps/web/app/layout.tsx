import type { Metadata } from "next";

import { fontVariables } from "@/app/brand-fonts";
import { AppShell } from "@/components/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "Corner Room",
  description: "Identity and platform shell",
};

const READY_SCRIPT = [
  "(function(){var d=document.documentElement;d.classList.add('js');",
  "var done=false;function go(){if(done)return;done=true;requestAnimationFrame(function(){d.classList.add('cr-ready');if(window.performance&&performance.mark){performance.mark('cr-ready')}})}",
  "setTimeout(go,700);document.addEventListener('DOMContentLoaded',function(){",
  "if(document.fonts&&document.fonts.ready){document.fonts.ready.then(go,go)}else{go()}})})()",
].join("");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Runs before first paint, independent of the app bundle. "js" lets entrance motion wait
            in its start pose (never for visitors without scripts); "cr-ready" starts it once the
            web fonts have loaded, or after 0.7 s at most, so it is seen rather than spent unseen. */}
        <script dangerouslySetInnerHTML={{ __html: READY_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
