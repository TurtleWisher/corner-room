"use client";

import { CircleAlert, CircleCheck, CircleDashed, ShieldCheck } from "lucide-react";

import { passwordStrength, type StrengthScore } from "@/lib/password-strength";
import { cn } from "@/lib/utils";

const TONE: Record<StrengthScore, { bar: string; text: string; Icon: typeof CircleAlert }> = {
  0: { bar: "bg-line-strong", text: "text-fg-muted", Icon: CircleDashed },
  1: { bar: "bg-danger", text: "text-danger", Icon: CircleAlert },
  2: { bar: "bg-warning", text: "text-warning", Icon: CircleAlert },
  3: { bar: "bg-success", text: "text-success", Icon: CircleCheck },
  4: { bar: "bg-success", text: "text-success", Icon: ShieldCheck },
};

/**
 * Advisory strength meter under a new-password field. Colour is never the only signal: each level
 * has an icon and a word, and the result is announced politely to screen readers.
 */
export function PasswordStrengthMeter({ id, password, email, name }: { id: string; password: string; email?: string; name?: string }) {
  const result = passwordStrength(password, { email, name });
  const tone = TONE[result.score];
  const empty = password.length === 0;

  return (
    <div id={id} className="space-y-1.5">
      <div aria-hidden="true" className="grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={cn("h-1 transition-colors duration-200", !empty && result.score >= step ? tone.bar : "bg-line")} />
        ))}
      </div>
      <p aria-live="polite" className="text-xs">
        {empty ? (
          <span className="text-fg-muted">At least 8 characters. A few unrelated words make a strong password.</span>
        ) : (
          <>
            <span className={cn("inline-flex items-center gap-1 font-semibold", tone.text)}>
              <tone.Icon aria-hidden="true" className="size-3.5" />
              <span>
                <span className="sr-only">Password strength: </span>
                {result.label}
              </span>
            </span>
            {result.hints.length ? <span className="text-fg-muted"> · {result.hints.join(" ")}</span> : null}
          </>
        )}
      </p>
    </div>
  );
}
