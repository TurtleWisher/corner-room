import type { Metadata } from "next";

import { fontVariables } from "@/app/brand-fonts";
import { AppShell } from "@/components/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "Corner Room",
  description: "Identity and platform shell",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
