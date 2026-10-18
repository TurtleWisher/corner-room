"use client";

/*
 * Staff console home (/staff). Staff sign-in, the staff join welcome and the "staff only" notice
 * all open here; before 2026-10-18 there was no page and they landed on a 404. It lists the
 * sections this person's console shows (the same list as the side navigation; visibility is UX
 * only, every page and the API still check permissions) and the workspace they act in.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { NavIcon } from "@/components/shell/nav-icons";
import { Card, Protected } from "@/components/staff/kit";
import { useWorkspace } from "@/components/workspace-provider";
import { staffNavSections } from "@/lib/nav-view";

function ConsoleHome() {
  const { user } = useAuth();
  const { currentOrg } = useWorkspace();
  const sections = staffNavSections(user?.permissions);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-fg">Staff console</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {currentOrg ? (
            <>
              Acting in <span className="font-semibold text-fg">{currentOrg.name}</span>. Change it from &ldquo;Acting in&rdquo; in the menu.
            </>
          ) : (
            <>Choose a workspace from &ldquo;Acting in&rdquo; in the menu; staff pages work inside it.</>
          )}
        </p>
      </div>
      {sections.map((section) => (
        <section key={section.label} aria-labelledby={`sec-${section.label}`}>
          <h2 id={`sec-${section.label}`} className="cr-eyebrow mb-3 text-fg-muted">
            {section.label}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="cr-focus group block">
                  <Card className="flex items-center gap-3 transition-colors group-hover:border-line-strong">
                    <NavIcon href={item.href} className="size-5 text-highlight" />
                    <span className="flex-1 font-semibold text-fg">{item.label}</span>
                    <ArrowRight aria-hidden="true" className="size-4 text-fg-muted group-hover:text-fg" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function StaffHomePage() {
  return (
    <Protected>
      <ConsoleHome />
    </Protected>
  );
}
