import { screenFairnessText } from "@/helpers/ai/fairness";

/** MP-REQ-010: checks a job passes before it enters any feed. Pure. */

export const MIN_DESCRIPTION_LENGTH = 100;

export type EligibilityInput = {
  title: string | null | undefined;
  description: string | null | undefined;
  locations: readonly string[] | null | undefined;
  remote: boolean | null | undefined;
  applyUrl: string | null | undefined;
  companyName: string | null | undefined;
  companyLogoUrl: string | null | undefined;
};

export type EligibilityCode =
  | "missing_title"
  | "short_description"
  | "missing_location"
  | "missing_apply_url"
  | "missing_company"
  | "missing_logo"
  | "placeholder_text"
  | "fairness";

export type EligibilityReason = { code: EligibilityCode; message: string };
export type EligibilityResult = { eligible: boolean; reasons: EligibilityReason[] };

const PLACEHOLDER = /\b(?:lorem ipsum|tbd|tba|to be decided|to be determined|job title here|your text here|xxx+)\b/i;

const blank = (v: string | null | undefined) => !v || v.trim().length === 0;

export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  const add = (code: EligibilityCode, message: string) => reasons.push({ code, message });

  const title = input.title?.trim() ?? "";
  const description = input.description?.trim() ?? "";

  if (!title) add("missing_title", "Missing title");
  if (description.length < MIN_DESCRIPTION_LENGTH) {
    add("short_description", `Description is shorter than ${MIN_DESCRIPTION_LENGTH} characters`);
  }
  const hasLocation = (input.locations ?? []).some((l) => !blank(l));
  if (!hasLocation && !input.remote) add("missing_location", "Missing location");
  if (blank(input.applyUrl)) add("missing_apply_url", "Missing apply link");
  if (blank(input.companyName)) add("missing_company", "Missing company name");
  if (blank(input.companyLogoUrl)) add("missing_logo", "Missing company logo");

  if (PLACEHOLDER.test(title) || PLACEHOLDER.test(description)) {
    add("placeholder_text", "Contains placeholder text");
  }

  const fair = screenFairnessText(`${title}\n${description}`, { context: "job_post" });
  if (!fair.ok) add("fairness", `Wording about ${fair.term} can't be distributed`);

  return { eligible: reasons.length === 0, reasons };
}
