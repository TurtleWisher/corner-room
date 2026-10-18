import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

/** Next.js recommended rules (core web vitals + TypeScript). Added in Phase 16 (D-P16-06). */
const eslintConfig = [
  { ignores: [".next/**", ".next-staging/**", "node_modules/**", "out/**", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
