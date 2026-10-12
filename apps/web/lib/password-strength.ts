/**
 * Advisory password strength for the sign-up form. It guides people; it does not decide anything.
 * The only enforced rule is the server's (at least 8 characters, auth.py RegisterRequest); a
 * stricter policy would be an owner decision, so a "weak" password here is still accepted.
 * Runs entirely in the browser: the password is never sent anywhere to be scored.
 */

export type StrengthScore = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  score: StrengthScore;
  label: "Too short" | "Weak" | "Fair" | "Good" | "Strong";
  /** Short, actionable suggestions, most useful first. Empty when the password is strong. */
  hints: string[];
}

/** Mirrors the server minimum. Change both together. */
export const PASSWORD_MIN_LENGTH = 8;

const LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;

// A short list of the passwords people try first; enough to catch the obvious ones offline.
const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "12345678",
  "123456789", "1234567890", "11111111", "00000000", "87654321", "qwertyui", "qwerty123",
  "qwertyuiop", "asdfghjk", "iloveyou", "letmein1", "welcome1", "admin123", "abc12345",
  "football", "baseball", "sunshine", "princess", "dragon12", "monkey12", "superman",
  "bangladesh", "dhaka123", "cornerroom", "trustno1", "whatever", "changeme",
]);

const SEQUENCES = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

function hasSequence(lower: string): boolean {
  for (const seq of SEQUENCES) {
    for (let i = 0; i + 4 <= seq.length; i += 1) {
      const run = seq.slice(i, i + 4);
      if (lower.includes(run) || lower.includes([...run].reverse().join(""))) return true;
    }
  }
  return false;
}

function characterKinds(password: string): number {
  let kinds = 0;
  if (/[a-z]/.test(password)) kinds += 1;
  if (/[A-Z]/.test(password)) kinds += 1;
  if (/[0-9]/.test(password)) kinds += 1;
  if (/[^A-Za-z0-9]/.test(password)) kinds += 1; // symbols, spaces, Bangla and other scripts
  return kinds;
}

/** Pieces of the person's own details that should not appear in the password. */
function personalParts(context: { email?: string; name?: string }): string[] {
  const parts = [context.email?.split("@")[0] ?? "", ...(context.name ?? "").split(/\s+/)];
  return parts.map((p) => p.toLowerCase()).filter((p) => p.length >= 3);
}

export function passwordStrength(password: string, context: { email?: string; name?: string } = {}): PasswordStrength {
  const length = [...password].length; // count Bangla and emoji as people see them
  if (length < PASSWORD_MIN_LENGTH) {
    return { score: 0, label: LABELS[0], hints: [`Use at least ${PASSWORD_MIN_LENGTH} characters.`] };
  }

  const lower = password.toLowerCase();
  const hints: string[] = [];
  let score = length >= 16 ? 4 : length >= 12 ? 3 : length >= 10 ? 2 : 1;

  const kinds = characterKinds(password);
  if (kinds >= 3 && length < 16) score += 1;
  if (kinds <= 1 && length < 16) {
    score -= 1;
    hints.push("Mix in numbers, symbols or capital letters.");
  }

  if (/(.)\1{2,}/.test(password) || hasSequence(lower)) {
    score -= 1;
    hints.push("Avoid repeated or sequential characters like aaa or 1234.");
  }

  const stripped = lower.replace(/[^a-z0-9]/g, "");
  if (COMMON.has(lower) || COMMON.has(stripped) || COMMON.has(stripped.replace(/\d+$/, ""))) {
    score = Math.min(score, 1);
    hints.unshift("This is a commonly used password. Choose something less predictable.");
  }

  if (personalParts(context).some((part) => lower.includes(part))) {
    score = Math.min(score, 1);
    hints.push("Don't use your name or email in your password.");
  }

  if (length < 12 && score < 4) hints.push("Longer is stronger: try 12 or more characters, or a few unrelated words.");

  const clamped = Math.max(1, Math.min(4, score)) as StrengthScore;
  return { score: clamped, label: LABELS[clamped], hints: clamped === 4 ? [] : hints.slice(0, 2) };
}
