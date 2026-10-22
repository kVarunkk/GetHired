import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// BL-CON-002: features never read plan columns directly. Limits and allowances
// go through helpers/billing/entitlements.ts (or the SQL functions).
const BILLING_MESSAGE =
  "Read plans and limits through helpers/billing (checkEntitlement, assertLimit, getEntitlements), not company_tiers (BL-CON-002).";

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["app/**/*.{ts,tsx}", "helpers/**/*.{ts,tsx}"],
    ignores: ["helpers/billing/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/company_tiers\\s*\\(/]", message: BILLING_MESSAGE },
        { selector: "TemplateElement[value.raw=/company_tiers\\s*\\(/]", message: BILLING_MESSAGE },
        {
          selector: "CallExpression[callee.property.name='from'][arguments.0.value='company_tiers']",
          message: BILLING_MESSAGE,
        },
      ],
    },
  },
  {
    // Every logged error also goes to PostHog error tracking.
    files: ["{app,helpers,lib,utils,hooks,components}/**/*.{ts,tsx}", "middleware.ts"],
    ignores: ["**/*.test.{ts,tsx}", "helpers/posthog/**", "lib/posthog/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "console",
          property: "error",
          message:
            "Use reportError (helpers/posthog/report-error) on the server or reportClientError (lib/posthog/report-client-error) in the browser, so the error reaches PostHog.",
        },
      ],
    },
  },
];

export default eslintConfig;
