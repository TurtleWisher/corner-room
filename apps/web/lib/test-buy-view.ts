/*
 * Words for platform admins' test buys (owner, 2026-11-21, D-STREAM-03, D-TEST-BUY-01). Platform
 * admins play every song; when they buy, it is a test: no money moves, and the order never reaches
 * sales, royalties, finance, the artist or analytics. The server decides who is a platform admin
 * and whether an order is a test (`is_test`); this only reads it out.
 */

export const TEST_BUY_WORDS = {
  title: "Test buy",
  body: "You're Corner Room staff, so this is a test: no money moves, and it never reaches sales, royalties, the artist or any live numbers. The music is added to your library.",
  panelTitle: "Finish the test",
  button: "Complete as a test",
  link: "Test buy",
  receipt: "Test buy, no money",
  tag: "Test",
} as const;

/** What the receipt says was paid: a test is never money. */
export function paidWords(order: { is_test?: boolean; paid_with_credit_minor?: number }): "test" | "credit" | "money" {
  if (order.is_test) return "test";
  if (order.paid_with_credit_minor) return "credit";
  return "money";
}
