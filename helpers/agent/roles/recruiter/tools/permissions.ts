import { canAny, forbiddenMessage, permissionEntry, type PermissionKey } from "@/helpers/companies/permissions";
import { requireToolPermission, type RecruiterToolContext } from "./shared";

/**
 * Where a call's job comes from, for scope (RP-REQ-031):
 * - `any`: no job; rows are filtered by RLS (lists), any scope will do;
 * - `jobPostId`: the input's `jobPostId` (absent: any scope);
 * - `jobPostIdOrNone`: the input's `jobPostId`, and no job needs scope all
 *   (outreach without a job, RP-REQ-002);
 * - `applicationId` / `applicationIds`: the job of each application;
 * - `noteId`: the job of the note's application (a note on a talent-pool
 *   candidate has none: scope all, as when adding it).
 */
export type JobSource = "any" | "jobPostId" | "jobPostIdOrNone" | "applicationId" | "applicationIds" | "noteId";

export type ToolPermission = {
  /** Any one of these (at any scope) puts the tool in the user's tool set. */
  keys: readonly [PermissionKey, ...PermissionKey[]];
  job?: JobSource;
};

const p = (keys: ToolPermission["keys"], job: JobSource = "any"): ToolPermission => ({ keys, job });

/**
 * RP-REQ-030: what each recruiter tool needs. `Record` over the tool names,
 * so a new tool that doesn't declare one fails type-checking (and
 * tools/index.test.ts checks it at runtime). Every tool also needs agent.use,
 * which requireAgentUser checks before any tool exists.
 */
export const RECRUITER_TOOL_PERMISSIONS = {
  getMyCompany: p(["agent.use"]),
  listMyJobs: p(["jobs.view"]),
  getJobPost: p(["jobs.view"], "jobPostId"),
  createJobPost: p(["jobs.create"]),
  updateJobPost: p(["jobs.edit"], "jobPostId"),
  setJobPostStatus: p(["jobs.publish"], "jobPostId"),
  deleteJobPost: p(["jobs.delete"], "jobPostId"),
  // AF-REQ-004: anyone who edits a job can apply a set; question_sets.manage saves them.
  listQuestionSets: p(["jobs.view"]),
  applyQuestionSet: p(["jobs.edit"], "jobPostId"),
  // Copying a job's form also needs jobs.view on that job, checked in the tool.
  saveQuestionSet: p(["question_sets.manage"]),
  deleteQuestionSet: p(["question_sets.manage"]),
  searchCandidates: p(["talent.view"]),
  findMatchesForJob: p(["matching.run"], "jobPostId"),
  runMatchingForJob: p(["matching.run"], "jobPostId"),
  // Applicants are visible without the talent pool (company_can_view_candidate).
  getCandidateProfile: p(["talent.view", "applicants.view"]),
  compareCandidates: p(["talent.view", "applicants.view"]),
  saveCandidate: p(["talent.save"]),
  unsaveCandidate: p(["talent.save"]),
  listApplicants: p(["applicants.view"], "jobPostId"),
  getApplication: p(["applicants.view"], "applicationId"),
  getHiringFunnel: p(["applicants.view"], "jobPostId"),
  listStages: p(["applicants.view"]),
  // The same key as saveStagesAction.
  createStage: p(["settings.stages"]),
  renameStage: p(["settings.stages"]),
  reorderStages: p(["settings.stages"]),
  archiveStage: p(["settings.stages"]),
  // The same key as the template editor's actions.
  listEmailTemplates: p(["settings.templates"]),
  createEmailTemplate: p(["settings.templates"]),
  updateEmailTemplate: p(["settings.templates"]),
  deleteEmailTemplate: p(["settings.templates"]),
  moveApplications: p(["pipeline.move"], "applicationIds"),
  addNote: p(["notes.write"], "applicationId"),
  listNotes: p(["notes.view"], "applicationId"),
  // The same key as the note actions; helpers/pipeline/notes only touches the user's own notes.
  updateNote: p(["notes.write"], "noteId"),
  deleteNote: p(["notes.write"], "noteId"),
  addToTalentList: p(["talent_lists.manage"]),
  // The same keys as listTalentListsAction / saveTalentListAction.
  listTalentLists: p(["talent.view"]),
  renameTalentList: p(["talent_lists.manage"]),
  removeFromTalentList: p(["talent_lists.manage"]),
  deleteTalentList: p(["talent_lists.manage"]),
  explainMatch: p(["matching.run"], "jobPostId"),
  screenApplicants: p(["applicants.screen"], "jobPostId"),
  sendOutreach: p(["outreach.send"], "jobPostIdOrNone"),
  listOutreach: p(["outreach.view"], "jobPostId"),
  getOutreach: p(["outreach.view"]),
  // The same key as withdrawOutreachAction.
  withdrawOutreach: p(["outreach.view"]),
  saveMemory: p(["agent.use"]),
  deleteMemory: p(["agent.use"]),
  // RP-REQ-032: team, roles and hiring teams.
  listTeam: p(["team.view"]),
  listRoles: p(["roles.view"]),
  // The RPC returns only the jobs the user has jobs.assign on.
  listHiringTeams: p(["jobs.assign"]),
  getAuditLog: p(["audit.view"]),
  getRole: p(["roles.view"]),
  createRole: p(["roles.manage"]),
  updateRole: p(["roles.manage"]),
  deleteRole: p(["roles.manage"]),
  assignRole: p(["team.assign_roles"]),
  // The same keys as setDefaultRoleAction / removeMemberAction (removing someone else).
  setDefaultRole: p(["roles.manage"]),
  removeTeamMember: p(["team.remove"]),
  assignToJob: p(["jobs.assign"], "jobPostId"),
  unassignFromJob: p(["jobs.assign"], "jobPostId"),
  listInvites: p(["team.view"]),
  // A templateKey also needs roles.manage, checked in inviteMember.
  inviteTeamMember: p(["team.invite"]),
  resendInvite: p(["team.invite"]),
  revokeInvite: p(["team.invite"]),
  // CP-REQ-012: everyone on the team can see the careers page; careers.edit changes it.
  getCareersPage: p(["agent.use"]),
  updateCareersPage: p(["careers.edit"]),
  setCareersAddress: p(["careers.edit"]),
  setCareersPublished: p(["careers.edit"]),
  // Screening interviews (SIT-071). Configuring also needs jobs.edit, checked in the tool.
  getInterviewSetup: p(["interviews.view"], "jobPostId"),
  configureScreeningInterview: p(["interviews.manage"], "jobPostId"),
  inviteToInterview: p(["interviews.manage"], "applicationIds"),
  getInterviewReport: p(["interviews.view"], "applicationId"),
  compareInterviewReports: p(["interviews.view"], "applicationIds"),
} as const satisfies Record<string, ToolPermission>;

export type RecruiterToolName = keyof typeof RECRUITER_TOOL_PERMISSIONS;

/** Whether the tool belongs in the user's tool set (RP-REQ-030). */
export function toolAllowed(ctx: Pick<RecruiterToolContext, "company">, name: RecruiterToolName): boolean {
  return RECRUITER_TOOL_PERMISSIONS[name].keys.some((key) => canAny(ctx.company, key));
}

/**
 * RP-REQ-030: one line for the prompt naming what the user's role can't do,
 * from the tools it filtered out, so the model explains instead of trying.
 * Empty for owners.
 */
export function missingAbilities(ctx: Pick<RecruiterToolContext, "company">): string[] {
  const out = new Set<string>();
  for (const name of Object.keys(RECRUITER_TOOL_PERMISSIONS) as RecruiterToolName[]) {
    if (!toolAllowed(ctx, name)) out.add(permissionEntry(RECRUITER_TOOL_PERMISSIONS[name].keys[0]).deny);
  }
  return [...out];
}

/** Whether any of the user's grants are limited to assigned jobs. */
export function hasAssignedScope(ctx: Pick<RecruiterToolContext, "company">): boolean {
  if (ctx.company.isOwner) return false;
  return [...ctx.company.grants.values()].some((scope) => scope === "assigned");
}

/** The job ids a call touches, or undefined (any scope) / null (no job: scope all). */
async function jobsOf(
  ctx: RecruiterToolContext,
  source: JobSource,
  input: Record<string, unknown>,
): Promise<{ jobs: (string | null)[] | undefined } | { error: string }> {
  switch (source) {
    case "any":
      return { jobs: undefined };
    case "jobPostId":
      return { jobs: typeof input.jobPostId === "string" ? [input.jobPostId] : undefined };
    case "jobPostIdOrNone":
      return { jobs: [typeof input.jobPostId === "string" ? input.jobPostId : null] };
    case "applicationId":
    case "applicationIds": {
      const ids =
        source === "applicationId"
          ? typeof input.applicationId === "string"
            ? [input.applicationId]
            : []
          : Array.isArray(input.applicationIds)
            ? input.applicationIds.filter((id): id is string => typeof id === "string")
            : [];
      // A note on a talent-pool candidate has no application: no job, scope all.
      if (ids.length === 0) return { jobs: source === "applicationId" && "candidateId" in input ? [null] : undefined };
      return jobsOfApplications(ctx, ids);
    }
    case "noteId": {
      if (typeof input.noteId !== "string") return { jobs: undefined };
      const { data: note, error } = await ctx.supabase
        .from("candidate_notes")
        .select("application_id")
        .eq("id", input.noteId)
        .eq("company_id", ctx.company.id)
        .maybeSingle();
      if (error) throw new Error(`Failed to load the note: ${error.message}`);
      if (!note) return { error: "Note not found." };
      return note.application_id ? jobsOfApplications(ctx, [note.application_id]) : { jobs: [null] };
    }
  }
}

/** Each application's job, or an error when one isn't the company's. */
async function jobsOfApplications(
  ctx: RecruiterToolContext,
  ids: string[],
): Promise<{ jobs: string[] } | { error: string }> {
  // application_job_id is security definer and scoped to the caller's
  // company, so a job is found even where the role can't see the row.
  const jobs = await Promise.all(
    ids.map(async (id) => {
      const { data, error } = await ctx.supabase.rpc("application_job_id", { p_application_id: id });
      if (error) throw new Error(`application_job_id failed: ${error.message}`);
      return (data as string | null) ?? null;
    }),
  );
  if (jobs.some((job) => job === null)) return { error: "Application not found." };
  return { jobs: jobs as string[] };
}

/**
 * RP-REQ-031: checks the permission again at run time, with the job the call
 * touches. `ctx.company` is reloaded for every request (RP-SEC-004), so a
 * permission changed mid-session applies from the next message.
 */
export async function checkToolPermission(
  ctx: RecruiterToolContext,
  name: RecruiterToolName,
  input: unknown,
): Promise<{ error: string } | null> {
  const rule = RECRUITER_TOOL_PERMISSIONS[name] as ToolPermission;
  if (!toolAllowed(ctx, name)) return { error: forbiddenMessage(rule.keys[0]) };
  const resolved = await jobsOf(ctx, rule.job ?? "any", (input ?? {}) as Record<string, unknown>);
  if ("error" in resolved) return resolved;
  if (resolved.jobs === undefined) return null;
  for (const job of resolved.jobs) {
    // Any one of the keys at a scope that covers this job.
    const denials = rule.keys.map((key) => requireToolPermission(ctx, key, job));
    if (denials.every(Boolean)) return denials[0];
  }
  return null;
}
