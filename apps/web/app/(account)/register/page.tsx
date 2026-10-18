"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SignUpForm } from "@/components/account/sign-up-form";
import { withNext } from "@/lib/auth-view";

/** Fan registration. Artists join through their label's link, staff through an invitation. */
export default function RegisterPage() {
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => setNext(new URLSearchParams(window.location.search).get("next")), []);
  return (
    <SignUpForm
      next={next}
      footer={
        <>
          Already have an account?{" "}
          <Link href={withNext("/login", next)} className="cr-focus font-semibold text-highlight underline">
            Sign in
          </Link>
        </>
      }
    />
  );
}
