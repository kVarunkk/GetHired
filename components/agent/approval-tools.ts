/**
 * Which tools' approval cards need extra details. Kept apart from the cards,
 * so asking doesn't load them (lazy-cards.tsx).
 */
import type { ResumeEditTool } from "@/helpers/resumes/preview-resume-edit";

/** The agent tools whose approval card can carry a salary. */
export const SALARY_APPROVAL_TOOLS = ["updateMyPreferences", "completeOnboarding"];

/** The tools whose approval card shows the form they save. */
export const FORM_APPROVAL_TOOLS = ["createJobPost", "updateJobPost", "saveQuestionSet"];

export const isResumeEditTool = (name: string): name is ResumeEditTool =>
  ["createResume", "updateResume", "deleteResume", "applyReviewSuggestions"].includes(name);

export const ROLE_APPROVAL_TOOLS = [
  "createRole",
  "updateRole",
  "deleteRole",
  "assignRole",
  "setDefaultRole",
  "removeTeamMember",
  "assignToJob",
  "unassignFromJob",
  "inviteTeamMember",
  "resendInvite",
  "revokeInvite",
] as const;
export type RoleApprovalTool = (typeof ROLE_APPROVAL_TOOLS)[number];

export const isRoleApprovalTool = (name: string): name is RoleApprovalTool =>
  (ROLE_APPROVAL_TOOLS as readonly string[]).includes(name);

export type PipelineApprovalTool = "setJobPipeline" | "customizeJobPipeline";

export const isPipelineApprovalTool = (name: string): name is PipelineApprovalTool =>
  name === "setJobPipeline" || name === "customizeJobPipeline";
