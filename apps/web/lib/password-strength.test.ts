import { describe, expect, it } from "vitest";

import { PASSWORD_MIN_LENGTH, passwordStrength } from "./password-strength";

describe("passwordStrength", () => {
  it("calls anything under the server minimum too short", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(passwordStrength("").score).toBe(0);
    expect(passwordStrength("Ab1!xyz")).toMatchObject({ score: 0, label: "Too short" });
  });

  it("caps common passwords at weak, even with a twist", () => {
    for (const pw of ["password123", "Password123", "P@ssw0rd", "qwertyuiop", "Bangladesh2024"]) {
      expect(passwordStrength(pw).score, pw).toBeLessThanOrEqual(1);
    }
    expect(passwordStrength("password123").hints[0]).toMatch(/commonly used/);
  });

  it("caps passwords built from the person's own details", () => {
    const result = passwordStrength("Rahim#Long2026!", { email: "rahim@example.com", name: "Rahim Uddin" });
    expect(result.score).toBe(1);
    expect(result.hints.join(" ")).toMatch(/name or email/);
  });

  it("marks down repeats and keyboard runs", () => {
    expect(passwordStrength("aaaaaaaaaa").score).toBe(1);
    expect(passwordStrength("zx1234vbqk").score).toBeLessThan(passwordStrength("zx9a4vbqkt").score);
  });

  it("rewards length and variety", () => {
    expect(passwordStrength("tB7#qLm2").label).toBe("Fair");
    expect(passwordStrength("tB7#qLm2wz9!").label).toBe("Strong");
    expect(passwordStrength("violet ferry under paper lamp")).toMatchObject({ score: 4, label: "Strong", hints: [] });
  });

  it("counts Bangla characters as characters people type", () => {
    expect(passwordStrength("আমার গান শুনি রাতে").score).toBeGreaterThanOrEqual(3);
  });

  it("never returns more than two hints", () => {
    expect(passwordStrength("11111111", { name: "One" }).hints.length).toBeLessThanOrEqual(2);
  });
});
