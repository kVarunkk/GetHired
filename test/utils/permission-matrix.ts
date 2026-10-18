import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { PermissionKey } from "@/helpers/companies/permissions";
import type { MemberFixture } from "./team";
import { buildRequest } from "./request";

// RP-TEST-004: every company action, route and recruiter tool, run as each
// member fixture. A run only has to get past (or be stopped by) the
// permission check: the client below answers the membership lookup and makes
// every other database call, and every fetch, fail with PAST_AUTH. So a run
// never has side effects, and whatever happens after the check counts as
// "allowed".

export class PastAuth extends Error {
  constructor(what: string) {
    super(`PAST_AUTH: ${what}`);
  }
}

const JOB = "d0000000-0000-4000-8000-0000000000a1";
const APP = "e0000000-0000-4000-8000-0000000000a1";
const CANDIDATE = "a0000000-0000-4000-8000-000000000001";
const OTHER_USER = "c9000000-0000-4000-8000-000000000001";
const ID = "f0000000-0000-4000-8000-0000000000a1";

/**
 * A client that answers the session's membership lookups (`company_members`
 * for the teams-era `getMyCompany`, `my_company_access` after roles) and
 * fails everything else.
 */
export function pastAuthClient(member: MemberFixture): SupabaseClient<Database> {
  const fail = (what: string) => {
    const err = new PastAuth(what);
    const builder: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (_ok: unknown, onRejected?: (e: unknown) => unknown) =>
              Promise.reject(err).then(undefined, onRejected);
          }
          if (typeof prop === "symbol") return undefined;
          return () => builder;
        },
      },
    );
    return builder;
  };
  const answer = (data: unknown) => {
    const builder: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok);
          }
          if (typeof prop === "symbol") return undefined;
          return () => builder;
        },
      },
    );
    return builder;
  };
  const membership = (member as { membership: unknown }).membership;
  const forSchema = (schema: string) => ({
    from: (table: string) =>
      schema === "public" && table === "company_members" ? answer(membership) : fail(`from ${table}`),
    rpc: (fn: string) => {
      if (fn === "my_company_access") return answer(membership);
      if (fn === "touch_company_membership") return answer(null);
      return fail(`rpc ${fn}`);
    },
  });
  return {
    ...forSchema("public"),
    schema: (name: string) => forSchema(name),
    storage: { from: () => fail("storage") },
    auth: {
      getUser: async () => ({ data: { user: member.user }, error: null }),
      admin: new Proxy({}, { get: () => () => Promise.reject(new PastAuth("auth.admin")) }),
    },
  } as unknown as SupabaseClient<Database>;
}

export type MatrixKind = "action" | "route" | "tool";

export type MatrixEntry = {
  name: string;
  kind: MatrixKind;
  /**
   * The catalog key the spec maps it to (RPT-001), `"owner"` for owner-only
   * actions (RP-DEC-003) and `null` for membership-only ones.
   */
  permission: PermissionKey | "owner" | null;
  run: (member: MemberFixture) => Promise<unknown>;
};

const params = <T>(p: T) => ({ params: Promise.resolve(p) });

async function tool(name: string, input: Record<string, unknown>, member: MemberFixture) {
  const { createRecruiterTools } = await import("@/helpers/agent/roles/recruiter/tools");
  const tools = createRecruiterTools({
    supabase: pastAuthClient(member),
    user: member.user,
    sessionId: "s1",
    company: member.myCompany,
  }) as unknown as Record<string, { execute: (input: unknown, options: unknown) => Promise<unknown> }>;
  const t = tools[name];
  if (!t) {
    // RP-REQ-030: a tool the role can't use isn't in its tool set at all.
    // Only a declared tool counts; an unknown name is a broken entry.
    const { RECRUITER_TOOL_PERMISSIONS } = await import("@/helpers/agent/roles/recruiter/tools/permissions");
    if (name in RECRUITER_TOOL_PERMISSIONS) return FILTERED_OUT;
    throw new Error(`no tool ${name}`);
  }
  return t.execute(input, { toolCallId: "call-1", messages: [], context: undefined });
}

/** What `tool()` returns for a tool filtered out of the user's tool set. */
const FILTERED_OUT = Symbol("filtered out of the tool set");

const TOOL_INPUT = {
  jobPostId: JOB,
  applicationId: APP,
  applicationIds: [APP],
  candidateId: CANDIDATE,
  candidateIds: [CANDIDATE, "a0000000-0000-4000-8000-000000000002"],
  stageId: ID,
  status: "active",
  limit: 5,
};

function toolEntry(name: string, permission: PermissionKey, input: Record<string, unknown> = {}): MatrixEntry {
  return {
    name: `tool:${name}`,
    kind: "tool",
    permission,
    run: (m) => tool(name, { ...TOOL_INPUT, ...input }, m),
  };
}

export const PERMISSION_MATRIX: MatrixEntry[] = [
  // Billing management: owner only (RP-DEC-003).
  {
    name: "action:cancelCompanyPlan",
    kind: "action",
    permission: "owner",
    run: async () => (await import("@/app/actions/cancel-company-plan")).cancelCompanyPlanAction(),
  },
  {
    name: "action:changeCompanyPlan",
    kind: "action",
    permission: "owner",
    run: async () =>
      (await import("@/app/actions/change-company-plan")).changeCompanyPlanAction({ tierSlug: "growth" }),
  },
  {
    name: "action:resumeCompanyPlan",
    kind: "action",
    permission: "owner",
    run: async () => (await import("@/app/actions/resume-company-plan")).resumeCompanyPlanAction(),
  },
  {
    name: "action:openBillingPortal",
    kind: "action",
    permission: "owner",
    run: async () => (await import("@/app/actions/open-billing-portal")).openBillingPortalAction(),
  },
  {
    name: "route:POST /api/company/billing/checkout",
    kind: "route",
    permission: "owner",
    run: async () =>
      (await import("@/app/api/company/billing/checkout/route")).POST(
        buildRequest("/api/company/billing/checkout", {
          method: "POST",
          body: { kind: "plan", tierSlug: "growth", interval: "month" },
        }),
      ),
  },
  {
    name: "route:GET /api/company/billing",
    kind: "route",
    permission: "billing.view",
    run: async () => (await import("@/app/api/company/billing/route")).GET(),
  },

  // Jobs
  {
    name: "action:upsertJobPosting (create)",
    kind: "action",
    permission: "jobs.create",
    run: async () =>
      (await import("@/app/actions/upsert-job-posting")).upsertJobPostingAction({
        values: { title: "Engineer" } as never,
      }),
  },
  {
    name: "action:upsertJobPosting (edit)",
    kind: "action",
    permission: "jobs.edit",
    run: async () =>
      (await import("@/app/actions/upsert-job-posting")).upsertJobPostingAction({
        values: { title: "Engineer" } as never,
        existingPostingId: JOB,
      }),
  },
  {
    name: "action:setJobPostingStatus",
    kind: "action",
    permission: "jobs.publish",
    run: async () =>
      (await import("@/app/actions/set-job-posting-status")).setJobPostingStatusAction({
        jobPostingId: JOB,
        status: "inactive",
      }),
  },
  {
    name: "action:deleteJobPosting",
    kind: "action",
    permission: "jobs.delete",
    run: async () =>
      (await import("@/app/actions/delete-job-posting")).deleteJobPostingAction({ jobPostingId: JOB }),
  },

  // Applicants and pipeline
  {
    name: "route:GET /api/company/applications/[id]/screening",
    kind: "route",
    permission: "applicants.view",
    run: async () =>
      (await import("@/app/api/company/applications/[id]/screening/route")).GET(
        buildRequest(`/api/company/applications/${APP}/screening`),
        params({ id: APP }),
      ),
  },
  {
    name: "route:GET /api/company/job-posts/[job_id]/pipeline",
    kind: "route",
    permission: "applicants.view",
    run: async () =>
      (await import("@/app/api/company/job-posts/[job_id]/pipeline/route")).GET(
        buildRequest(`/api/company/job-posts/${JOB}/pipeline`),
        params({ job_id: JOB }),
      ),
  },
  {
    name: "route:POST /api/company/job-posts/[job_id]/screen",
    kind: "route",
    permission: "applicants.screen",
    run: async () =>
      (await import("@/app/api/company/job-posts/[job_id]/screen/route")).POST(
        buildRequest(`/api/company/job-posts/${JOB}/screen`, { method: "POST", body: {} }),
        params({ job_id: JOB }),
      ),
  },
  {
    name: "action:moveApplications",
    kind: "action",
    permission: "pipeline.move",
    run: async () =>
      (await import("@/app/actions/pipeline/move-applications")).moveApplicationsAction({
        applicationIds: [APP],
        stageId: ID,
      } as never),
  },
  {
    name: "action:previewAgentMove",
    kind: "action",
    permission: "pipeline.move",
    run: async () =>
      (await import("@/app/actions/pipeline/preview-agent-move")).previewAgentMoveAction({
        applicationIds: [APP],
        stageId: ID,
      }),
  },
  {
    name: "action:previewEmail",
    kind: "action",
    permission: "pipeline.move",
    run: async () =>
      (await import("@/app/actions/pipeline/preview-email")).previewEmailAction({
        applicationIds: [APP],
        stageId: ID,
      } as never),
  },
  {
    name: "action:updateApplicationStatus",
    kind: "action",
    permission: "pipeline.move",
    run: async () =>
      (await import("@/app/actions/update-application-status")).updateApplicationStatusAction({
        applicationIds: [APP],
        status: "interviewing",
      } as never),
  },

  // Notes
  {
    name: "action:addNote",
    kind: "action",
    permission: "notes.write",
    run: async () =>
      (await import("@/app/actions/pipeline/add-note")).addNoteAction({
        candidateUserId: CANDIDATE,
        applicationId: APP,
        body: "Strong",
      } as never),
  },
  {
    name: "action:updateNote",
    kind: "action",
    permission: "notes.write",
    run: async () =>
      (await import("@/app/actions/pipeline/update-note")).updateNoteAction({ noteId: ID, body: "x" } as never),
  },
  {
    name: "action:deleteNote",
    kind: "action",
    permission: "notes.write",
    run: async () => (await import("@/app/actions/pipeline/delete-note")).deleteNoteAction({ noteId: ID }),
  },

  // Talent
  {
    name: "action:listTalentLists",
    kind: "action",
    permission: "talent.view",
    run: async () => (await import("@/app/actions/pipeline/list-talent-lists")).listTalentListsAction({}),
  },
  {
    name: "action:saveTalentList",
    kind: "action",
    permission: "talent_lists.manage",
    run: async () =>
      (await import("@/app/actions/pipeline/save-talent-list")).saveTalentListAction({
        op: "create",
        name: "Shortlist",
      }),
  },
  {
    name: "action:triggerJobPostingRelevanceUpdate",
    kind: "action",
    permission: "matching.run",
    run: async () =>
      (await import("@/app/actions/relevant-profiles-update")).triggerJobPostingRelevanceUpdate(JOB as never),
  },
  {
    name: "route:POST /api/company/matches/explain",
    kind: "route",
    permission: "matching.run",
    run: async () =>
      (await import("@/app/api/company/matches/explain/route")).POST(
        buildRequest("/api/company/matches/explain", {
          method: "POST",
          body: { jobPostId: JOB, candidateId: CANDIDATE },
        }),
      ),
  },

  // Outreach
  {
    name: "route:GET /api/company/outreach",
    kind: "route",
    permission: "outreach.view",
    run: async () => (await import("@/app/api/company/outreach/route")).GET(buildRequest("/api/company/outreach")),
  },
  {
    name: "route:POST /api/company/outreach",
    kind: "route",
    permission: "outreach.send",
    run: async () =>
      (await import("@/app/api/company/outreach/route")).POST(
        buildRequest("/api/company/outreach", {
          method: "POST",
          body: { candidateId: CANDIDATE, subject: "Hi", message: "Hello" },
        }),
      ),
  },
  {
    name: "action:draftOutreach",
    kind: "action",
    permission: "outreach.send",
    run: async () =>
      (await import("@/app/actions/outreach/draft-outreach")).draftOutreachAction({
        candidateId: CANDIDATE,
      } as never),
  },
  {
    name: "action:loadOutreachComposer",
    kind: "action",
    permission: "outreach.send",
    run: async () =>
      (await import("@/app/actions/outreach/load-composer")).loadOutreachComposerAction({ candidateId: CANDIDATE }),
  },
  {
    name: "action:previewAgentOutreach",
    kind: "action",
    permission: "outreach.send",
    run: async () =>
      (await import("@/app/actions/outreach/preview-agent-outreach")).previewAgentOutreachAction({
        candidateId: CANDIDATE,
        subject: "Hi",
        message: "Hello",
      }),
  },
  {
    name: "action:sendOutreach",
    kind: "action",
    permission: "outreach.send",
    run: async () =>
      (await import("@/app/actions/outreach/send-outreach")).sendOutreachAction({
        candidateId: CANDIDATE,
        subject: "Hi",
        message: "Hello",
      } as never),
  },
  {
    // Senders can always withdraw their own; the RPC decides about others' (RP-REQ-002).
    name: "action:withdrawOutreach",
    kind: "action",
    permission: "outreach.view",
    run: async () =>
      (await import("@/app/actions/outreach/withdraw-outreach")).withdrawOutreachAction({ outreachId: ID }),
  },

  // Settings
  {
    name: "action:saveStages",
    kind: "action",
    permission: "settings.stages",
    run: async () =>
      (await import("@/app/actions/pipeline/save-stages")).saveStagesAction({ op: "archive", stageId: ID }),
  },
  {
    name: "action:createTemplate",
    kind: "action",
    permission: "settings.templates",
    run: async () =>
      (await import("@/app/actions/pipeline/create-template")).createTemplateAction({
        purpose: "custom",
        name: "T",
        subject: "S",
        body: "B",
      } as never),
  },
  {
    name: "action:saveTemplate",
    kind: "action",
    permission: "settings.templates",
    run: async () =>
      (await import("@/app/actions/pipeline/save-template")).saveTemplateAction({
        templateId: ID,
        name: "T",
        subject: "S",
        body: "B",
      } as never),
  },
  {
    name: "action:deleteTemplate",
    kind: "action",
    permission: "settings.templates",
    run: async () =>
      (await import("@/app/actions/pipeline/delete-template")).deleteTemplateAction({ templateId: ID }),
  },
  {
    name: "action:saveSchedulingLink",
    kind: "action",
    permission: "settings.scheduling",
    run: async () =>
      (await import("@/app/actions/pipeline/save-scheduling-link")).saveSchedulingLinkAction({
        schedulingUrl: "https://cal.com/acme",
      }),
  },
  {
    name: "action:saveNotificationSettings",
    kind: "action",
    permission: "settings.notifications",
    run: async () =>
      (await import("@/app/actions/pipeline/save-notification-settings")).saveCompanyNotificationSettingsAction({
        notifyNewApplicants: "off",
        notifyWeeklyMatches: false,
      } as never),
  },

  // Team
  {
    name: "action:inviteMember",
    kind: "action",
    permission: "team.invite",
    run: async () =>
      (await import("@/app/actions/team/invite-member")).inviteMemberAction({ email: "new@acme.dev" }),
  },
  {
    name: "action:resendInvite",
    kind: "action",
    permission: "team.invite",
    run: async () => (await import("@/app/actions/team/resend-invite")).resendInviteAction({ inviteId: ID }),
  },
  {
    name: "action:revokeInvite",
    kind: "action",
    permission: "team.invite",
    run: async () => (await import("@/app/actions/team/revoke-invite")).revokeInviteAction({ inviteId: ID }),
  },
  {
    name: "action:changeRole",
    kind: "action",
    permission: "team.assign_roles",
    run: async () =>
      (await import("@/app/actions/team/change-role")).changeRoleAction({ userId: OTHER_USER, roleId: ID }),
  },
  {
    name: "action:removeMember (someone else)",
    kind: "action",
    permission: "team.remove",
    run: async () => (await import("@/app/actions/team/remove-member")).removeMemberAction({ userId: OTHER_USER }),
  },
  {
    name: "action:removeMember (leave)",
    kind: "action",
    permission: null,
    run: async (m) => (await import("@/app/actions/team/remove-member")).removeMemberAction({ userId: m.user.id }),
  },
  {
    name: "action:setOwner",
    kind: "action",
    permission: "owner",
    run: async () =>
      (await import("@/app/actions/team/set-owner")).setOwnerAction({ userId: OTHER_USER, isOwner: true }),
  },
  {
    name: "action:makePrimaryOwner",
    kind: "action",
    permission: "owner",
    run: async () =>
      (await import("@/app/actions/team/make-primary-owner")).makePrimaryOwnerAction({
        userId: OTHER_USER,
        confirmName: "Acme",
      }),
  },

  // Roles (RP-REQ-003/008) and hiring teams (RP-REQ-011)
  {
    name: "action:createRole",
    kind: "action",
    permission: "roles.manage",
    run: async () =>
      (await import("@/app/actions/roles/create-role")).createRoleAction({ name: "Interviewer", grants: [] }),
  },
  {
    name: "action:updateRole",
    kind: "action",
    permission: "roles.manage",
    run: async () => (await import("@/app/actions/roles/update-role")).updateRoleAction({ roleId: ID, name: "X" }),
  },
  {
    name: "action:deleteRole",
    kind: "action",
    permission: "roles.manage",
    run: async () => (await import("@/app/actions/roles/delete-role")).deleteRoleAction({ roleId: ID }),
  },
  {
    name: "action:setDefaultRole",
    kind: "action",
    permission: "roles.manage",
    run: async () => (await import("@/app/actions/roles/set-default-role")).setDefaultRoleAction({ roleId: ID }),
  },
  {
    name: "action:listAudit",
    kind: "action",
    permission: "audit.view",
    run: async () => (await import("@/app/actions/audit/list-audit")).listAuditAction({ before: 100 }),
  },
  {
    name: "action:assignJob",
    kind: "action",
    permission: "jobs.assign",
    run: async () =>
      (await import("@/app/actions/jobs/assign-job")).assignJobAction({ jobPostId: JOB, userId: OTHER_USER }),
  },
  {
    name: "action:unassignJob",
    kind: "action",
    permission: "jobs.assign",
    run: async () =>
      (await import("@/app/actions/jobs/unassign-job")).unassignJobAction({ jobPostId: JOB, userId: OTHER_USER }),
  },
  {
    name: "action:updateDisplayName",
    kind: "action",
    permission: null,
    run: async () => (await import("@/app/actions/team/update-display-name")).updateDisplayNameAction({ name: "Me" }),
  },

  // Recruiter agent tools (each also needs agent.use, which Admin and Member hold).
  toolEntry("getMyCompany", "agent.use"),
  toolEntry("listMyJobs", "jobs.view"),
  toolEntry("getJobPost", "jobs.view"),
  toolEntry("createJobPost", "jobs.create", { title: "Engineer", description: "Build things" }),
  toolEntry("updateJobPost", "jobs.edit", { title: "Engineer" }),
  toolEntry("setJobPostStatus", "jobs.publish", { status: "inactive" }),
  toolEntry("deleteJobPost", "jobs.delete"),
  toolEntry("searchCandidates", "talent.view", { roles: ["Engineer"] }),
  toolEntry("findMatchesForJob", "matching.run"),
  toolEntry("runMatchingForJob", "matching.run"),
  toolEntry("getCandidateProfile", "talent.view"),
  toolEntry("compareCandidates", "talent.view"),
  toolEntry("saveCandidate", "talent.save"),
  toolEntry("unsaveCandidate", "talent.save"),
  toolEntry("listApplicants", "applicants.view"),
  toolEntry("getApplication", "applicants.view"),
  toolEntry("getHiringFunnel", "applicants.view"),
  toolEntry("listStages", "applicants.view"),
  toolEntry("createStage", "settings.stages", { name: "Take-home", kind: "interview" }),
  toolEntry("renameStage", "settings.stages", { stageId: ID, name: "Take-home" }),
  toolEntry("reorderStages", "settings.stages", { stageIds: [ID] }),
  toolEntry("archiveStage", "settings.stages", { stageId: ID }),
  toolEntry("listEmailTemplates", "settings.templates"),
  toolEntry("createEmailTemplate", "settings.templates", { purpose: "custom", name: "T", subject: "S", body: "B" }),
  toolEntry("updateEmailTemplate", "settings.templates", { templateId: ID, subject: "S" }),
  toolEntry("deleteEmailTemplate", "settings.templates", { templateId: ID }),
  toolEntry("moveApplications", "pipeline.move"),
  toolEntry("addNote", "notes.write", { body: "Strong" }),
  toolEntry("listNotes", "notes.view"),
  toolEntry("updateNote", "notes.write", { noteId: ID, body: "Edited" }),
  toolEntry("deleteNote", "notes.write", { noteId: ID }),
  toolEntry("addToTalentList", "talent_lists.manage", { listName: "Shortlist" }),
  toolEntry("listTalentLists", "talent.view"),
  toolEntry("renameTalentList", "talent_lists.manage", { listId: ID, name: "Bench" }),
  toolEntry("removeFromTalentList", "talent_lists.manage", { listId: ID }),
  toolEntry("deleteTalentList", "talent_lists.manage", { listId: ID }),
  toolEntry("explainMatch", "matching.run"),
  toolEntry("screenApplicants", "applicants.screen"),
  toolEntry("sendOutreach", "outreach.send", { subject: "Hi", message: "Hello" }),
  toolEntry("listOutreach", "outreach.view"),
  toolEntry("getOutreach", "outreach.view", { outreachId: ID }),
  toolEntry("withdrawOutreach", "outreach.view", { outreachId: ID }),
  toolEntry("setDefaultRole", "roles.manage", { roleId: ID }),
  toolEntry("removeTeamMember", "team.remove", { memberId: ID }),
  toolEntry("saveMemory", "agent.use", { content: "We hire for craft" }),
  toolEntry("deleteMemory", "agent.use", { memoryId: "abcd1234" }),
];

const FORBIDDEN = [
  /^Only owners and admins/,
  /^Only the company's owner/,
  /^Only the company's owners/,
  /^Your role can't/,
  /^Only owners can/,
];

const isForbiddenText = (text: unknown) =>
  typeof text === "string" && FORBIDDEN.some((re) => re.test(text));

export type MatrixOutcome = "allowed" | "forbidden" | `error: ${string}`;

/**
 * Runs one entry and reports whether the permission check stopped it. A
 * throw that isn't PAST_AUTH (a module failing to load, a missing mock) is
 * reported as an error, so it can't pass for "allowed".
 */
export async function runEntry(entry: MatrixEntry, member: MemberFixture): Promise<MatrixOutcome> {
  let result: unknown;
  try {
    result = await entry.run(member);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes("PAST_AUTH") ? "allowed" : `error: ${message}`;
  }
  if (result === FILTERED_OUT) return "forbidden";
  if (result instanceof Response) {
    if (result.status !== 403) return "allowed";
    const body = (await result.json().catch(() => null)) as { error?: unknown } | null;
    return isForbiddenText(body?.error) ? "forbidden" : "allowed";
  }
  if (result && typeof result === "object" && "error" in result) {
    return isForbiddenText((result as { error: unknown }).error) ? "forbidden" : "allowed";
  }
  return "allowed";
}
