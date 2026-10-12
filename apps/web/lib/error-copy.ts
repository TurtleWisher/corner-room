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
  ACCOUNT_LOCKED: "This account is locked. Contact support.",
  ACCOUNT_NOT_ACTIVE: "This account is not active yet.",
  INVITATION_EXPIRED: "This invitation has expired.",
  INVITATION_CONSUMED: "This invitation has already been used.",
  WORKSPACE_REQUIRED: "Choose a workspace first.",
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
    if (err.code === "ACCOUNT_NOT_ACTIVE") return "Your account is waiting for verification.";
    if (err.code === "ACCOUNT_LOCKED") return "This account is locked. Contact support.";
    if (err.status === 422) return "Enter a valid email address and your password.";
  }
  return friendlyError(err, "Sign in failed. Please try again.");
}
