import { createApplicantTools } from "./applicants";
import { createCandidateTools } from "./candidates";
import { createCompanyTools } from "./company";
import { createJobTools } from "./jobs";
import { createMatchingTools } from "./matching";
import { createRecruiterMemoryTools } from "./memory";
import type { RecruiterToolContext } from "./shared";

export type { RecruiterToolContext } from "./shared";

/**
 * The recruiter agent's tools, bound to the session's company (RA spec §4.3).
 * Phases 4–6 (pipeline, outreach, screening interviews) add theirs here.
 */
export function createRecruiterTools(ctx: RecruiterToolContext) {
  return {
    ...createCompanyTools(ctx),
    ...createJobTools(ctx),
    ...createCandidateTools(ctx),
    ...createApplicantTools(ctx),
    ...createMatchingTools(ctx),
    ...createRecruiterMemoryTools(ctx),
  };
}

export type RecruiterTools = ReturnType<typeof createRecruiterTools>;
