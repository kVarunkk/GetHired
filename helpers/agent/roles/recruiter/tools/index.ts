import { createApplicantTools } from "./applicants";
import { createCandidateTools } from "./candidates";
import { createCompanyTools } from "./company";
import { createJobTools } from "./jobs";
import { createMatchingTools } from "./matching";
import { createRecruiterMemoryTools } from "./memory";
import { createOutreachTools } from "./outreach";
import { createPipelineTools } from "./pipeline";
import type { RecruiterToolContext } from "./shared";

export type { RecruiterToolContext } from "./shared";

/**
 * The recruiter agent's tools, bound to the session's company (RA spec §4.3).
 * Phase 6 (screening interviews) adds its tools here.
 */
export function createRecruiterTools(ctx: RecruiterToolContext) {
  return {
    ...createCompanyTools(ctx),
    ...createJobTools(ctx),
    ...createCandidateTools(ctx),
    ...createApplicantTools(ctx),
    ...createMatchingTools(ctx),
    ...createPipelineTools(ctx),
    ...createOutreachTools(ctx),
    ...createRecruiterMemoryTools(ctx),
  };
}

export type RecruiterTools = ReturnType<typeof createRecruiterTools>;
