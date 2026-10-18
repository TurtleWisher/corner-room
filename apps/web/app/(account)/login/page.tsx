"use client";

import Link from "next/link";

import { SignInForm } from "@/components/account/sign-in-form";
import { withNext } from "@/lib/auth-view";

/** Fan sign-in. Artists and staff have their own pages (/studio/sign-in, /staff/sign-in). */
export default function LoginPage() {
  return (
    <SignInForm
      footer={(next) => (
        <>
          New to Corner Room?{" "}
          <Link href={withNext("/register", next)} className="cr-focus font-semibold text-highlight underline">
            Create an account
          </Link>
        </>
      )}
    />
  );
}
