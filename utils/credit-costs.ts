import { TAICredits } from "@/utils/types";
import type { AllowanceKey } from "@/helpers/billing/keys";

// What each AI feature costs, shown on the credits pages instead of next to
// every button. Applicant costs come from TAICredits, the same numbers the
// server deducts, so this list can't drift from what's charged.

export type CreditCost = {
  feature: string;
  detail?: string;
  /** e.g. "5 credits" or "10 credits per session". */
  cost: string;
};

const credits = (n: number, per?: string) =>
  `${n} ${n === 1 ? "credit" : "credits"}${per ? ` ${per}` : ""}`;

/** Applicant features, cheapest first. */
export const APPLICANT_CREDIT_COSTS: CreditCost[] = [
  {
    feature: "Apply to a job on GetHired",
    cost: credits(TAICredits.JOB_APPLICATION, "per application"),
  },
  {
    feature: "AI job summary",
    detail: "Summarize with AI on a job's page.",
    cost: credits(TAICredits.AI_SUMMARY),
  },
  {
    feature: "AI Smart Search",
    detail: "Find suitable jobs or companies, and similar jobs.",
    cost: credits(TAICredits.AI_SEARCH_ASK_AI_RESUME, "per search"),
  },
  {
    feature: "Job search by description",
    detail: "When the assistant searches from what you describe.",
    cost: credits(TAICredits.AI_SEARCH_ASK_AI_RESUME, "per search"),
  },
  {
    feature: "Resume upload",
    detail: "AI reads your resume so it can be matched to jobs.",
    cost: credits(TAICredits.AI_SEARCH_ASK_AI_RESUME, "per resume"),
  },
  {
    feature: "AI resume review",
    cost: credits(TAICredits.AI_SEARCH_ASK_AI_RESUME, "per review"),
  },
  {
    feature: "AI answers to application questions",
    detail: "On GetHired and in the browser extension.",
    cost: credits(TAICredits.AI_SEARCH_ASK_AI_RESUME, "per answer"),
  },
  {
    feature: "AI mock interview",
    cost: credits(TAICredits.AI_INTERVIEW, "per session"),
  },
];

/** What each company allowance covers. Limits (job posts, seats) aren't paid in credits. */
export const ALLOWANCE_FEATURES: Record<
  AllowanceKey,
  { feature: string; detail: string; unit: string }
> = {
  screenings: {
    feature: "AI applicant screening",
    detail: "A fit score and recommendation for an applicant.",
    unit: "screening",
  },
  match_explanations: {
    feature: "Match explanations",
    detail: "Why a candidate fits one of your jobs.",
    unit: "explanation",
  },
  agent_messages: {
    feature: "Hiring assistant",
    detail: "Each message you send to the assistant.",
    unit: "message",
  },
  outreach: {
    feature: "Outreach",
    detail: "A message inviting a candidate to apply.",
    unit: "message",
  },
  interview_minutes: {
    feature: "AI screening interviews",
    detail: "Each minute of a candidate's interview.",
    unit: "minute",
  },
};

/**
 * A company's cost list from its plan: each allowance and what it costs in
 * credits once the month's allowance is used up (null: it stops instead).
 */
export function companyCreditCosts(
  overageCredits: Partial<Record<AllowanceKey, number | null | undefined>>,
): CreditCost[] {
  return (Object.keys(ALLOWANCE_FEATURES) as AllowanceKey[]).map((key) => {
    const { feature, detail, unit } = ALLOWANCE_FEATURES[key];
    const overage = overageCredits[key];
    return {
      feature,
      detail,
      cost:
        typeof overage === "number"
          ? `${credits(overage, `per ${unit}`)} beyond your plan`
          : "Included in your plan only",
    };
  });
}
