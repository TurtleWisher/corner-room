import { ApiError } from "@/lib/api";

/*
 * Customer-facing copy for API errors. The API's `detail` text is written for engineers (it can
 * cite internal decision IDs), so customer pages map the stable error `code` to plain words and
 * fall back to a calm generic line. Staff tools may still show the API detail.
 */

const COPY: Record<string, string> = {
  SUBSCRIPTION_EXISTS: "You already have an active subscription.",
  ENTITLEMENT_REQUIRED: "You need a plan or a purchase to play this.",
  TRACK_AUDIO_UNAVAILABLE: "This track is not available to play right now.",
  TICKET_TYPE_NOT_ON_SALE: "These tickets are not on sale right now.",
  SALES_WINDOW_CLOSED: "Ticket sales for this event have closed.",
  INSUFFICIENT_INVENTORY: "There are not enough tickets left for that quantity.",
  HOLD_EXPIRED: "Your ticket hold expired. Please start again.",
  PAYMENT_NOT_CAPTURED: "The payment has not gone through yet.",
  CURRENCY_MISMATCH: "This item cannot be bought in that currency.",
  TRACK_NOT_SOLD_SEPARATELY: "This song is sold only as part of its album or EP.",
  ALREADY_OWNED: "You already own this.",
  RELEASE_NOT_AVAILABLE: "This release isn't on sale right now.",
  OFFER_NOT_ELIGIBLE: "This price is for fans who already own some of these songs.",
  ORDER_CANCELLED: "This order was cancelled because the reservation ran out. Please start again.",
  DELIVERY_ADDRESS_REQUIRED: "Add a Bangladesh address where we can send your gifts before you pay.",
  DELIVERY_ADDRESS_CONFIRMATION_REQUIRED: "Confirm the address where we can send your gifts before you pay.",
  ACCOUNT_LOCKED: "This account is locked. Contact support.",
  ACCOUNT_NOT_ACTIVE: "This account is not active yet.",
  INVITATION_EXPIRED: "This invitation has expired.",
  INVITATION_CONSUMED: "This invitation has already been used.",
  WORKSPACE_REQUIRED: "Choose a workspace first.",
  // A step that no longer fits (it moved on since the page loaded, e.g. approved meanwhile).
  INVALID_TRANSITION: "That can't be done at this stage. Refresh the page to see where things stand.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  NETWORK_ERROR: "We could not reach Corner Room. Check your connection and try again.",
};

const BY_STATUS: Record<number, string> = {
  401: "Please sign in again.",
  403: "You do not have access to this.",
  404: "We could not find that.",
  409: "That conflicts with something that already exists.",
  422: "Please check the details and try again.",
  429: "Too many attempts. Please wait a moment and try again.",
};

/** Plain-language message for a failed request, never internal details. */
export function friendlyError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof ApiError) {
    return COPY[err.code] ?? BY_STATUS[err.status] ?? fallback;
  }
  return fallback;
}

/** Sign-in outcomes (account.md section 5): wrong details, awaiting verification, locked. */
export function signInError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "That email and password do not match an account.";
    if (err.code === "ACCOUNT_NOT_ACTIVE") return "Your account is not verified yet.";
    if (err.code === "ACCOUNT_LOCKED") return "This account is locked. Contact support.";
    if (err.status === 422) return "Enter a valid email address and your password.";
  }
  return friendlyError(err, "Sign in failed. Please try again.");
}

/** Copy for `?google_error=` after "Continue with Google". Unknown codes get a calm generic line. */
const GOOGLE_COPY: Record<string, string> = {
  cancelled: "Google sign-in was cancelled. You can try again or use your email and password.",
  state_invalid: "That Google sign-in expired or was already used. Please try again.",
  provider_unavailable: "Google sign-in is not responding right now. Please try again in a moment.",
  code_rejected: "Google sign-in did not finish. Please try again.",
  token_invalid: "We could not confirm your Google account. Please try again.",
  email_unverified: "Your Google account's email is not verified with Google, so we cannot use it to sign you in.",
  link_requires_password:
    "An account with this email already exists but is not verified yet. Verify it first (try signing in with your email and password to get a new link), then you can use Google.",
  link_conflict: "This Google account could not be connected. Please sign in with your email and password.",
  account_unavailable: "This account is not available. Contact support if you think this is a mistake.",
  account_locked: "This account is locked. Contact support.",
  account_not_active: "This account is not active right now. Contact support if you think this is a mistake.",
  rate_limited: "Too many attempts. Please wait a little and try again.",
  not_configured: "Google sign-in is not available yet. Please use your email and password.",
};

export function googleSignInError(code: string | null | undefined): string | null {
  if (!code) return null;
  return GOOGLE_COPY[code] ?? "Google sign-in did not work. Please try again or use your email and password.";
}
