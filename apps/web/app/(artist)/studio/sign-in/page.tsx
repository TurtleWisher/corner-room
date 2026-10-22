"use client";

/*
 * Artist sign-in (owner, 2026-10-17: artists and staff sign in on their own pages, not the main
 * one). Same Corner Room account; it opens Studio afterwards. New artists join through the link
 * their label shares (/studio/join?code=...), so there is no open sign-up here.
 */

import { SignInForm } from "@/components/account/sign-in-form";

export default function ArtistSignInPage() {
  return (
    <SignInForm
      theme="artist-studio"
      title="Artist sign-in"
      intro="Sign in to Studio to publish your music and see how it is doing."
      defaultNext="/studio"
      footer={() => (
        <>
          New to Corner Room as an artist? Use the join link your label sent you. Already listening here? Sign in, then choose
          &ldquo;Apply as an artist&rdquo; in your menu.
        </>
      )}
    />
  );
}
