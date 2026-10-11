import { createApplicationTools } from "./applications";
import { createInterviewTools } from "./interviews";
import { createJobTools } from "./jobs";
import { createMemoryTools } from "./memory";
import { createOnboardingTools } from "./onboarding";
import { createProfileTools } from "./profile";
import { createResumeTools } from "./resumes";
import type { AgentToolContext } from "./shared";

export type { AgentToolContext } from "./shared";

/** All agent tools, bound to the requesting user's context (spec §4.3). */
export function createAgentTools(ctx: AgentToolContext) {
  return {
    ...createProfileTools(ctx),
    ...createOnboardingTools(ctx),
    ...createJobTools(ctx),
    ...createApplicationTools(ctx),
    ...createResumeTools(ctx),
    ...createInterviewTools(ctx),
    ...createMemoryTools(ctx),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
