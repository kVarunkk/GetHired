import type { Tool } from "ai";
import { createApplicantTools } from "./applicants";
import { createCandidateTools } from "./candidates";
import { createCareersTools } from "./careers";
import { createCompanyTools } from "./company";
import { createJobTools } from "./jobs";
import { createMatchingTools } from "./matching";
import { createRecruiterMemoryTools } from "./memory";
import { createOutreachTools } from "./outreach";
import { createPipelineTools } from "./pipeline";
import { createQuestionSetTools } from "./question-sets";
import {
  checkToolPermission,
  RECRUITER_TOOL_PERMISSIONS,
  toolAllowed,
  type RecruiterToolName,
  type ToolPermission,
} from "./permissions";
import { createRoleTools } from "./roles";
import { createTemplateTools } from "./templates";
import { withToolErrors, type RecruiterToolContext } from "./shared";

export type { RecruiterToolContext } from "./shared";

/** Every recruiter tool, before the user's permissions filter them. */
export function createAllRecruiterTools(ctx: RecruiterToolContext) {
  return {
    ...createCompanyTools(ctx),
    ...createJobTools(ctx),
    ...createQuestionSetTools(ctx),
    ...createCandidateTools(ctx),
    ...createApplicantTools(ctx),
    ...createMatchingTools(ctx),
    ...createPipelineTools(ctx),
    ...createTemplateTools(ctx),
    ...createOutreachTools(ctx),
    ...createRoleTools(ctx),
    ...createCareersTools(ctx),
    ...createRecruiterMemoryTools(ctx),
  };
}

type AllRecruiterTools = ReturnType<typeof createAllRecruiterTools>;

// RP-REQ-030: a tool without an entry in RECRUITER_TOOL_PERMISSIONS doesn't compile.
const PERMISSIONS: Record<keyof AllRecruiterTools, ToolPermission> = RECRUITER_TOOL_PERMISSIONS;

/**
 * The recruiter agent's tools, bound to the session's company (RA spec §4.3).
 * Only the tools the user's role allows are included (RP-REQ-030), and each
 * one checks again when it runs, with the job the call touches (RP-REQ-031).
 * Phase 6 (screening interviews) adds its tools here.
 */
export function createRecruiterTools(ctx: RecruiterToolContext): Partial<AllRecruiterTools> {
  const all = createAllRecruiterTools(ctx);
  const allowed: Partial<AllRecruiterTools> = {};
  for (const name of Object.keys(all) as (keyof AllRecruiterTools)[]) {
    if (!PERMISSIONS[name] || !toolAllowed(ctx, name as RecruiterToolName)) continue;
    const original = all[name] as Tool;
    const execute = original.execute;
    (allowed as Record<string, Tool>)[name] = execute
      ? {
          ...original,
          execute: async (input: unknown, options: Parameters<NonNullable<Tool["execute"]>>[1]) => {
            const denied = await withToolErrors(ctx, name, () =>
              checkToolPermission(ctx, name as RecruiterToolName, input),
            );
            if (denied) return denied;
            return execute(input, options);
          },
        }
      : original;
  }
  return allowed;
}

export type RecruiterTools = ReturnType<typeof createRecruiterTools>;
