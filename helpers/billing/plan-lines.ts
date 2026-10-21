// Client-safe: the plan cards and the pricing page's markdown version (/pricing/companies.md).
import { KEY_LABELS, type EntitlementKey } from "./keys";
import type { Plan } from "./plans";

export const SIGNUP_HREF = "/auth/sign-up?company=true";
export const ENTERPRISE_HREF = "mailto:varun@devhub.co.in?subject=GetHired%20Enterprise";

/** The keys shown for each plan, in order. */
export const SHOWN_KEYS: EntitlementKey[] = [
  "active_job_posts",
  "seats",
  "profiles_per_search",
  "screenings",
  "outreach",
  "interview_minutes",
  "agent_messages",
];

/** "10 active job posts", "500 screenings / month", "∞ seats", or null when the plan lacks the key. */
export function amountLine(plan: Plan, key: EntitlementKey) {
  const e = plan.entitlements[key];
  if (!e) return null;
  const label = KEY_LABELS[key].many;
  if (e.amount === null) return `∞ ${label}`;
  const perMonth = e.kind === "allowance" ? " / month" : "";
  return `${e.amount.toLocaleString("en-US")} ${label}${perMonth}`;
}
