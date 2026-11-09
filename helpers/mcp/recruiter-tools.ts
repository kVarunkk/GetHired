/**
 * The recruiter MCP catalog (RMCP spec §4.4): one row per recruiter agent
 * tool, each running through that tool (createRecruiterTools with
 * `surface: "mcp"`), so MCP and /company/agent share one implementation, one
 * permission check and one set of guardrails (RMCP-REQ-003).
 *
 * A new recruiter agent tool gets a row here or an entry in
 * RECRUITER_MCP_EXCLUDED_TOOLS; recruiter-tools.test.ts checks it.
 */
import type { RecruiterToolName } from "@/helpers/agent/roles/recruiter/tools/permissions";
import type { RecruiterToolContext, RecruiterTools } from "@/helpers/agent/roles/recruiter/tools";
import { CANDIDATES_LIST_PATH, candidateImportPath, jobImportPath, newCandidatePath } from "@/helpers/candidates/paths";
import { RECRUITER_MCP_PREVIEWS } from "./recruiter-previews";
import type { McpToolAnnotations, McpToolDef } from "./tools";

export type RecruiterMcpToolDef = McpToolDef<RecruiterToolName, RecruiterToolContext, RecruiterTools> &
  Required<Pick<McpToolDef, "toolset">>;

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const hints = ({
  destructive,
  idempotent,
  openWorld = false,
}: {
  destructive: boolean;
  idempotent: boolean;
  openWorld?: boolean;
}): McpToolAnnotations => ({
  readOnlyHint: false,
  destructiveHint: destructive,
  idempotentHint: idempotent,
  openWorldHint: openWorld,
});
// The spec's hint codes: D destructive, I idempotent, O open world.
const D_I = hints({ destructive: true, idempotent: true });
const D_NI = hints({ destructive: true, idempotent: false });
const ND_I = hints({ destructive: false, idempotent: true });
const ND_NI = hints({ destructive: false, idempotent: false });
const D_I_O = hints({ destructive: true, idempotent: true, openWorld: true });
const D_NI_O = hints({ destructive: true, idempotent: false, openWorld: true });
const ND_NI_O = hints({ destructive: false, idempotent: false, openWorld: true });

/** A row that is one agent tool taken as is. */
const row = (
  name: string,
  title: string,
  toolset: RecruiterMcpToolDef["toolset"],
  annotations: McpToolAnnotations,
  agentTool: RecruiterToolName,
  extra: Partial<Pick<RecruiterMcpToolDef, "description" | "email" | "preview">> = {},
): RecruiterMcpToolDef => ({ name, title, toolset, annotations, agentTools: [agentTool], ...extra });

/** A confirm row (alwaysAsk or a gated write), with its preview from recruiter-previews.ts (§4.6). */
const confirmRow = (...args: Parameters<typeof row>): RecruiterMcpToolDef => {
  const preview = RECRUITER_MCP_PREVIEWS[args[0]];
  if (!preview) throw new Error(`MCP tool ${args[0]} asks for confirmation but has no preview.`);
  return row(args[0], args[1], args[2], args[3], args[4], { preview, ...args[5] });
};

export const RECRUITER_MCP_TOOLS: readonly RecruiterMcpToolDef[] = [
  // --- core ---
  row("get_my_company", "My company and plan", "core", READ, "getMyCompany"),

  // --- jobs ---
  row("list_my_jobs", "Job posts", "jobs", READ, "listMyJobs"),
  row("get_job_post", "Job post details", "jobs", READ, "getJobPost"),
  row("list_question_sets", "Question sets", "jobs", READ, "listQuestionSets"),
  confirmRow("create_job_post", "Create a job post", "jobs", ND_NI, "createJobPost"),
  confirmRow("update_job_post", "Edit a job post", "jobs", D_I, "updateJobPost"),
  confirmRow("set_job_post_status", "Publish or unpublish a job post", "jobs", D_I_O, "setJobPostStatus"),
  confirmRow("delete_job_post", "Delete a job post", "jobs", D_NI, "deleteJobPost"),
  confirmRow("apply_question_set", "Apply a question set", "jobs", D_I, "applyQuestionSet"),
  confirmRow("save_question_set", "Save a question set", "jobs", ND_NI, "saveQuestionSet"),
  confirmRow("delete_question_set", "Delete a question set", "jobs", D_I, "deleteQuestionSet"),

  // --- talent ---
  row("search_candidates", "Search the talent pool", "talent", READ, "searchCandidates"),
  row("find_matches_for_job", "Matches for a job", "talent", READ, "findMatchesForJob"),
  row("get_candidate_profile", "Candidate profile", "talent", READ, "getCandidateProfile"),
  row("compare_candidates", "Compare candidates", "talent", READ, "compareCandidates"),
  row("explain_match", "Explain a match", "talent", READ, "explainMatch"),
  confirmRow("run_matching_for_job", "Run matching for a job", "talent", ND_NI, "runMatchingForJob", {
    description:
      "Start matching talent-pool candidates to one of the company's jobs (AI processing, so it counts toward the hourly limit on calls that use credits or allowances). It runs in the background for a few minutes; the company gets an email when it's done, and find_matches_for_job lists the results.",
  }),
  row("save_candidate", "Save a candidate", "talent", ND_I, "saveCandidate"),
  row("unsave_candidate", "Unsave a candidate", "talent", ND_I, "unsaveCandidate"),

  // --- applicants ---
  row("list_applicants", "Applicants", "applicants", READ, "listApplicants"),
  row("get_application", "Application details", "applicants", READ, "getApplication"),
  row("get_hiring_funnel", "Hiring funnel", "applicants", READ, "getHiringFunnel"),
  confirmRow("screen_applicants", "Screen applicants", "applicants", ND_NI, "screenApplicants"),

  // --- pipeline ---
  row("list_stages", "Pipeline stages", "pipeline", READ, "listStages"),
  row("list_notes", "Notes", "pipeline", READ, "listNotes"),
  row("create_stage", "Add a pipeline stage", "pipeline", ND_NI, "createStage"),
  row("rename_stage", "Rename a pipeline stage", "pipeline", ND_I, "renameStage"),
  row("reorder_stages", "Reorder pipeline stages", "pipeline", ND_I, "reorderStages"),
  confirmRow("archive_stage", "Archive a pipeline stage", "pipeline", D_I, "archiveStage"),
  confirmRow("move_applications", "Move applications", "pipeline", D_NI_O, "moveApplications", { email: true }),
  confirmRow("add_note", "Add a note", "pipeline", ND_NI, "addNote"),
  confirmRow("update_note", "Edit a note", "pipeline", D_I, "updateNote"),
  confirmRow("delete_note", "Delete a note", "pipeline", D_I, "deleteNote"),

  // --- lists ---
  row("list_talent_lists", "Talent lists", "lists", READ, "listTalentLists"),
  row("add_to_talent_list", "Add to a talent list", "lists", ND_I, "addToTalentList"),
  row("rename_talent_list", "Rename a talent list", "lists", ND_I, "renameTalentList"),
  row("remove_from_talent_list", "Remove from a talent list", "lists", ND_I, "removeFromTalentList"),
  confirmRow("delete_talent_list", "Delete a talent list", "lists", D_I, "deleteTalentList"),

  // --- candidates ---
  row("find_pool_candidates", "Your candidates for a job", "candidates", READ, "findPoolCandidates"),
  row("list_imports", "Imports", "candidates", READ, "listImports", {
    description: `List the company's recent spreadsheet and resume imports, newest first: what each was, its job, whether it's being read, waiting for review, confirmed (with its counts) or expired. Imports that aren't confirmed are deleted 7 days after they started. New imports are uploaded in the GetHired app: ${candidateImportPath("resumes")} or ${candidateImportPath("spreadsheet")} for the company's candidates, or ${jobImportPath("<jobPostId>")} for a job.`,
  }),
  row("get_import", "Import details", "candidates", READ, "getImport", {
    description: `Review one import (a batchId from list_imports): its status, the rows per status and 25 rows at a time, the ones that need attention first. Statuses: ready; error (fields that need a fix, with the messages); needs_email (a resume going into a job without an email); failed (a resume that couldn't be read); existing (already one of the company's candidates); known (already on GetHired and in the pipeline: never imported, linked instead); duplicate_in_file (a repeat of an earlier row, skipped); reading (not read yet). Never includes contact details, only whether there is an email or phone. For a spreadsheet going into a job, stageValues lists the Stage column's values for confirm_import's stageMap. Files are uploaded in the GetHired app (${candidateImportPath("resumes")}, or ${jobImportPath("<jobPostId>")} for a job), not over MCP.`,
  }),
  confirmRow("add_candidates_to_job", "Add your candidates to a job", "candidates", ND_NI, "addCandidatesToJob"),
  confirmRow("update_import_rows", "Fix import rows", "candidates", ND_I, "updateImportRows"),
  confirmRow("remove_import_rows", "Remove import rows", "candidates", D_I, "removeImportRows"),
  row("retry_import_rows", "Read failed resumes again", "candidates", ND_NI, "retryImportRows"),
  confirmRow("confirm_import", "Confirm an import", "candidates", ND_NI, "confirmImport", {
    description:
      "Import a reviewed spreadsheet or resume batch (batchId from get_import) into the company's candidates, and optionally a talent list and/or a job at a stage (ids from list_my_jobs, list_stages and list_talent_lists; newListName creates a list). Rows that still need a fix, failed or are still being read are left out; for a job, every resume needs an email first. Nobody is emailed. With autoInvite, people who score at or above the job's AI interview threshold are invited to it. The user's confirmation records that the company has a lawful basis to process these people's data; pass the basis they named, if any, as lawfulBasisNote.",
  }),
  confirmRow("add_candidate", "Add a candidate", "candidates", ND_NI, "addCandidate", {
    description: `Add one person to the company's candidates by hand (a referral, someone who emailed a resume), optionally into a talent list and/or a job at a stage. Use only details the user gave you; never guess an email or phone. A job needs their email. Nobody is emailed. Their resume is uploaded afterwards on their page in the GetHired app (${CANDIDATES_LIST_PATH}/<candidateId>), or the whole person at ${newCandidatePath()}. The user's confirmation records that the company has a lawful basis to process this person's data; pass the basis they named, if any, as lawfulBasisNote.`,
  }),
  row("list_my_candidates", "Your candidates", "candidates", READ, "listMyCandidates"),
  row("get_my_candidate", "Your candidate's details", "candidates", READ, "getMyCandidate"),
  row("find_jobs_for_my_candidate", "Jobs for your candidate", "candidates", READ, "findJobsForMyCandidate"),
  confirmRow("update_my_candidate", "Edit your candidate", "candidates", D_I, "updateMyCandidate", {
    description: `Change details of one of the company's own candidates (null clears a field). Use only details the user gave you; never guess an email or phone. Tags and notes are replaced, not added to: read get_my_candidate first. It can't add or replace their resume: that's uploaded on their page in the GetHired app (${CANDIDATES_LIST_PATH}/<candidateId>).`,
  }),
  confirmRow("delete_my_candidates", "Delete your candidates", "candidates", D_I, "deleteMyCandidates"),
  row("add_my_candidates_to_list", "Add your candidates to a list", "candidates", ND_I, "addMyCandidatesToList"),
  row("remove_my_candidate_from_list", "Remove your candidate from a list", "candidates", ND_I, "removeMyCandidateFromList"),

  // --- outreach ---
  row("list_outreach", "Outreach", "outreach", READ, "listOutreach"),
  row("get_outreach", "Outreach message", "outreach", READ, "getOutreach"),
  row("list_email_templates", "Email templates", "outreach", READ, "listEmailTemplates"),
  confirmRow("send_outreach", "Message a candidate", "outreach", D_NI_O, "sendOutreach", { email: true }),
  confirmRow("withdraw_outreach", "Withdraw outreach", "outreach", D_I, "withdrawOutreach"),
  row("create_email_template", "Add an email template", "outreach", ND_NI, "createEmailTemplate"),
  row("update_email_template", "Edit an email template", "outreach", D_I, "updateEmailTemplate"),
  confirmRow("delete_email_template", "Delete an email template", "outreach", D_I, "deleteEmailTemplate"),

  // --- interviews ---
  row("get_interview_setup", "AI interview setup", "interviews", READ, "getInterviewSetup"),
  row("get_interview_report", "AI interview report", "interviews", READ, "getInterviewReport"),
  row("compare_interview_reports", "Compare AI interview reports", "interviews", READ, "compareInterviewReports"),
  confirmRow(
    "configure_screening_interview",
    "Set up the AI interview",
    "interviews",
    D_I,
    "configureScreeningInterview",
  ),
  confirmRow("invite_to_interview", "Invite to the AI interview", "interviews", D_NI_O, "inviteToInterview", {
    email: true,
  }),

  // --- team ---
  row("list_team", "Team", "team", READ, "listTeam"),
  row("list_hiring_teams", "Hiring teams", "team", READ, "listHiringTeams"),
  row("get_audit_log", "Audit log", "team", READ, "getAuditLog"),
  row("list_roles", "Roles", "team", READ, "listRoles"),
  row("get_role", "Role details", "team", READ, "getRole"),
  row("list_invites", "Open invites", "team", READ, "listInvites"),
  confirmRow("create_role", "Create a role", "team", ND_NI, "createRole"),
  confirmRow("update_role", "Change a role", "team", D_I, "updateRole"),
  confirmRow("delete_role", "Delete a role", "team", D_I, "deleteRole"),
  confirmRow("assign_role", "Change a member's role", "team", D_I, "assignRole"),
  confirmRow("set_default_role", "Set the default role", "team", ND_I, "setDefaultRole"),
  confirmRow("remove_team_member", "Remove a team member", "team", D_I, "removeTeamMember"),
  confirmRow("assign_to_job", "Add to a hiring team", "team", ND_I, "assignToJob"),
  confirmRow("unassign_from_job", "Remove from a hiring team", "team", D_I, "unassignFromJob"),
  confirmRow("invite_team_member", "Invite a team member", "team", ND_NI_O, "inviteTeamMember"),
  confirmRow("resend_invite", "Resend an invite", "team", ND_NI_O, "resendInvite"),
  confirmRow("revoke_invite", "Revoke an invite", "team", D_I, "revokeInvite"),

  // --- careers ---
  row("get_careers_page", "Careers page", "careers", READ, "getCareersPage"),
  confirmRow("update_careers_page", "Edit the careers page", "careers", D_I_O, "updateCareersPage"),
  confirmRow("set_careers_address", "Change the careers page address", "careers", D_I, "setCareersAddress"),
  confirmRow("set_careers_published", "Publish or unpublish the careers page", "careers", D_I_O, "setCareersPublished"),
];

/** Recruiter agent tools MCP leaves out, and why (RMCP spec §4.4). */
export const RECRUITER_MCP_EXCLUDED_TOOLS: Partial<Record<RecruiterToolName, string>> = {
  requestResumeImport: `A browser widget. Resumes are uploaded in the GetHired app (${candidateImportPath("resumes")}, or a job's Import candidates section).`,
  requestSpreadsheetImport: `A browser widget. Spreadsheets are uploaded in the GetHired app (${candidateImportPath("spreadsheet")}, or a job's Import candidates section).`,
  requestCandidateResume: "A browser widget. A candidate's resume is uploaded on their page in the GetHired app.",
  askUser: "A question card in the chat. MCP clients ask the user themselves.",
  saveMemory: "Agent memory, which means nothing outside the chat.",
  deleteMemory: "Agent memory, which means nothing outside the chat.",
};

/** Each catalog row's agent tool name to its MCP name, for rewriting agent descriptions. */
export const RECRUITER_MCP_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  RECRUITER_MCP_TOOLS.flatMap((def) => def.agentTools.map((agentTool) => [agentTool, def.name])),
);
