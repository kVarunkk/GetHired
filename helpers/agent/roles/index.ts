import { applicantRole } from "./applicant";
import { recruiterRole } from "./recruiter";
import type { AgentRole, AgentRoleId } from "./types";

export type { AgentRole, AgentRoleId, AgentRoleToolContext, PromptInput } from "./types";

/** The agent's roles, keyed by `app_metadata.type` (RA spec §4.1). */
export const AGENT_ROLES: Record<AgentRoleId, AgentRole> = {
  applicant: applicantRole,
  company: recruiterRole,
};
