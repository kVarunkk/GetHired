/**
 * What a company user confirms before a recruiter confirm tool runs over MCP
 * (RMCP spec §4.6): one builder per confirm row of RECRUITER_MCP_TOOLS.
 *
 * Where the agent's approval card shows a server preview, the builder formats
 * the same helper's result, so both surfaces show the same facts. The others
 * are built from the input plus one read. Every builder first runs the tool's
 * own permission check (checkToolPermission, with the job the call touches),
 * only reads, spends nothing, and returns an error instead of a preview when
 * the call would fail anyway. Candidate-written text (names, notes, import
 * rows) is sandboxed, and contact details never appear (RMCP-SEC-003/004).
 */
import "server-only";
import { wrapInSandbox } from "@/helpers/ai/security";
import type { RecruiterToolContext } from "@/helpers/agent/roles/recruiter/tools";
import {
  checkToolPermission,
  type RecruiterToolName,
} from "@/helpers/agent/roles/recruiter/tools/permissions";
import { formatSalary, requireToolPermission } from "@/helpers/agent/roles/recruiter/tools/shared";
import { applicationPersonOrNull, COMPANY_CANDIDATE_PERSON_COLUMNS } from "@/helpers/applications/application-person";
import { toCareersPage, type CareersPage } from "@/helpers/careers/get-careers-page";
import { LINK_KEYS, LINK_LABELS } from "@/helpers/careers/page-schema";
import { careersPath } from "@/helpers/careers/slug";
import { previewAgentAddToJob } from "@/helpers/candidates/preview-agent-add-to-job";
import {
  previewAgentAddCandidate,
  previewAgentDeleteCandidates,
  previewAgentImport,
  type DestinationPreview,
} from "@/helpers/candidates/preview-agent-import";
import { importRowView } from "@/helpers/candidates/import-rows";
import { DUPLICATE_ACTION_LABELS, type DuplicateAction } from "@/helpers/candidates/preview-rows";
import { previewAgentRole } from "@/helpers/companies/preview-agent-role";
import { describeGrantChange, describeLimitChange } from "@/helpers/companies/role-diff";
import { previewAgentInterviewInvite } from "@/helpers/interview/screening/preview-agent-interview-invite";
import { readApplicationForm } from "@/helpers/jobs/application-form-schema";
import { loadQuestionSets } from "@/helpers/jobs/load-question-sets";
import { previewAgentJobDelete } from "@/helpers/jobs/preview-agent-job-delete";
import { countUnscreenedApplications } from "@/helpers/matching/queue-screenings";
import { previewAgentOutreach } from "@/helpers/outreach/preview-agent-outreach";
import { previewAgentMove } from "@/helpers/pipeline/preview-agent-move";
import { PROTECTED_KINDS } from "@/helpers/pipeline/stages";
import { statusForKind } from "@/helpers/pipeline/status-map";
import { loadVisibleCandidates } from "@/helpers/profiles/visible-candidates";
import { formatDate } from "@/utils/date";
import { display, type McpPreview, type McpPreviewBuilder } from "./previews";

type Builder = McpPreviewBuilder<RecruiterToolContext>;
type Detail = { label: string; value: string };
type Input = Record<string, unknown>;

/** A preview, leaving out details with nothing to show. */
const preview = (summary: string, details: (Detail | null | false | undefined | "")[]): McpPreview => ({
  ok: true,
  summary,
  details: details.filter((d): d is Detail => !!d && d.value !== ""),
});

const refuse = (error: string): McpPreview => ({ ok: false, error });

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Candidate-written text, one sandbox per value (RMCP-SEC-004). */
const sandboxed = (tag: string, text: string) => wrapInSandbox(tag, text);
const names = (list: string[]) => sandboxed("candidate_names", list.join("\n"));

/**
 * Runs the agent tool's own permission check for this input, so the preview
 * refuses what the run would (RP-REQ-031).
 */
async function gate(ctx: RecruiterToolContext, tool: RecruiterToolName, input: Input) {
  const denied = await checkToolPermission(ctx, tool, input);
  return denied ? refuse(denied.error) : null;
}

/** A builder that checks the tool's permission before building. */
const gated =
  (tool: RecruiterToolName, build: (ctx: RecruiterToolContext, input: Input) => Promise<McpPreview>): Builder =>
  async (ctx, input) =>
    (await gate(ctx, tool, input)) ?? build(ctx, input);

// --- Formatting the approval cards' helpers ------------------------------------

const statusText = (status: string) => status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");

const destinationText = (d: DestinationPreview) =>
  [
    "your candidates",
    d.listName && `${d.newList ? "a new list, " : "the list "}${d.listName}`,
    d.jobTitle && `${d.jobTitle} (${d.stageName ? `stage ${d.stageName}` : "its first stage"})`,
  ]
    .filter(Boolean)
    .join(", ");

const lawfulBasis = (input: Input): Detail => {
  const note = str(input.lawfulBasisNote)?.trim();
  return {
    label: "Lawful basis",
    value: `Confirming records that the company has a lawful basis to process these people's data and to contact them about roles${note ? ` (${note})` : ""}.`,
  };
};

const previewMove: Builder = async (ctx, input) => {
  const result = await previewAgentMove(ctx, input);
  if (!result.ok) {
    const unknown = result.unknownVariables?.length ? ` Unknown variables: ${result.unknownVariables.join(", ")}.` : "";
    return refuse(`This move won't go through: ${result.error}${unknown}`);
  }
  const moving = result.applications.filter((a) => a.moves);
  if (moving.length === 0) return refuse("Nothing to move: they're all in this stage already.");
  const staying = result.applications.length - moving.length;
  const what = plural(moving.length, "application", "applications");
  return preview(result.email ? `Move ${what} to ${result.stage.name} and email the candidates?` : `Move ${what} to ${result.stage.name}?`, [
    { label: "Stage", value: result.stage.name },
    { label: "Candidates see", value: statusText(statusForKind(result.stage.kind)) },
    { label: "Applicants", value: names(moving.map((a) => `${a.name?.trim() || "Applicant"} · ${a.jobTitle}`)) },
    (staying > 0 || result.notFound > 0) && {
      label: "Skipped",
      value: [staying > 0 && `${staying} already in this stage`, result.notFound > 0 && `${result.notFound} not found`]
        .filter(Boolean)
        .join(", "),
    },
    { label: "Email", value: result.email ? plural(result.email.recipients, "candidate", "candidates") : "None" },
    // The rendered email holds the first candidate's name.
    result.email && {
      label: result.email.recipients > 1 ? "Email (shown for the first candidate)" : "Email text",
      value: sandboxed("email_preview", `${result.email.subject}\n\n${result.email.body}`),
    },
  ]);
};

const previewOutreach: Builder = async (ctx, input) => {
  const result = await previewAgentOutreach(ctx, input);
  if (!result.ok) return refuse(`This message won't go through: ${result.error}`);
  if (!result.acceptsOutreach) return refuse("This message won't go through: the candidate isn't accepting outreach right now.");
  if (!result.jobFound) return refuse("This message won't go through: that job wasn't found in your company.");
  if (result.quota?.remaining === 0) return refuse("This message won't go through: you've used this month's outreach.");
  const quota = result.quota
    ? result.quota.remaining === null
      ? "Unlimited on your plan"
      : `Uses 1 of ${result.quota.remaining} left this month (of ${result.quota.amount ?? result.quota.remaining})`
    : null;
  return preview("Send this message on GetHired? They answer on GetHired; contact details are shared only if they say they're interested.", [
    { label: "To", value: sandboxed("candidate_name", result.candidateName?.trim() || "Candidate") },
    { label: "Job", value: result.jobTitle ?? "No job" },
    quota && { label: "Outreach", value: quota },
    result.openSince && {
      label: "Note",
      value: `They haven't answered your message from ${formatDate(result.openSince, { day: "numeric", month: "short" })} yet.`,
    },
    { label: "Subject", value: str(input.subject) ?? "" },
    { label: "Message", value: str(input.message) ?? "" },
  ]);
};

const previewJobDelete: Builder = async (ctx, input) => {
  const result = await previewAgentJobDelete(ctx, input);
  if (!result.ok) return refuse(`This delete won't go through: ${result.error}`);
  const applications = plural(result.applications, "application", "applications");
  return preview(
    result.applications === 0
      ? "Delete this job post? This can't be undone."
      : `Delete this job post? The ${applications} and their notes are deleted too. This can't be undone.`,
    [
      { label: "Job", value: result.title },
      { label: "Status", value: result.status === "active" ? "Published" : "Not published" },
      { label: "Applications", value: result.applications === 0 ? "None" : applications },
    ],
  );
};

const previewAddToJob: Builder = async (ctx, input) => {
  const result = await previewAgentAddToJob(ctx, input);
  if (!result.ok) return refuse(`This won't go through: ${result.error}`);
  const adding = result.candidates.filter((c) => c.hasEmail);
  const skipping = result.candidates.filter((c) => !c.hasEmail);
  if (adding.length === 0) return refuse("Nobody here can be added: they have no email or aren't your candidates.");
  return preview(`Add ${plural(adding.length, "of your candidates", "of your candidates")} to ${result.jobTitle}? No one is emailed.`, [
    { label: "Job", value: result.jobTitle },
    { label: "Stage", value: result.stageName ?? "Its first stage" },
    { label: "Adding", value: names(adding.map((c) => c.name)) },
    skipping.length > 0 && { label: "No email, won't be added", value: names(skipping.map((c) => c.name)) },
    result.notFound > 0 && { label: "Not found", value: String(result.notFound) },
  ]);
};

const previewConfirmImport: Builder = async (ctx, input) => {
  const result = await previewAgentImport(ctx, input);
  if (!result.ok) return refuse(`This won't go through: ${result.error}`);
  if (result.missingEmail > 0) {
    return refuse(
      `This won't go through: ${plural(result.missingEmail, "resume has", "resumes have")} no email. Everyone going into a job needs one: add them or remove those rows first.`,
    );
  }
  return preview("Import these people? No one is emailed.", [
    result.fileName && { label: "File", value: sandboxed("import_file_name", result.fileName) },
    { label: "Into", value: destinationText(result) },
    { label: "Importing", value: plural(result.importing, "person", "people") },
    result.existing > 0 && { label: "Already your candidates", value: String(result.existing) },
    result.known > 0 && { label: "Already on GetHired (linked, not imported again)", value: String(result.known) },
    result.noEmailForJob > 0 && { label: "Without an email, not added to the job", value: String(result.noEmailForJob) },
    result.leftOut > 0 && { label: "Left out (needs a fix, failed or a repeat)", value: String(result.leftOut) },
    result.reading > 0 && { label: "Still being read, not included", value: String(result.reading) },
    lawfulBasis(input),
  ]);
};

const previewAddCandidate: Builder = async (ctx, input) => {
  const result = await previewAgentAddCandidate(ctx, input);
  if (!result.ok) return refuse(`This won't go through: ${result.error}`);
  return preview(`Add ${result.name || "this person"} to your candidates? No one is emailed.`, [
    { label: "Into", value: destinationText(result) },
    lawfulBasis(input),
  ]);
};

const previewDeleteCandidates: Builder = async (ctx, input) => {
  const result = await previewAgentDeleteCandidates(ctx, input);
  if (!result.ok) return refuse(`This won't go through: ${result.error}`);
  if (result.candidates.length === 0) return refuse("None of these are your candidates.");
  const count = result.candidates.length;
  return preview(
    `Delete ${count === 1 ? "this candidate" : `these ${count} candidates`}? Their imported applications, list places and resumes are deleted too. This can't be undone.`,
    [
      {
        label: "Candidates",
        value: names(result.candidates.map((c) => (c.jobs > 0 ? `${c.name} · in ${plural(c.jobs, "job", "jobs")}` : c.name))),
      },
      result.notFound > 0 && { label: "Not found", value: String(result.notFound) },
    ],
  );
};

const previewInterviewInvite: Builder = async (ctx, input) => {
  const result = await previewAgentInterviewInvite(ctx, input);
  if (!result.ok) return refuse(`These invites won't go through: ${result.error}`);
  const inviting = result.applicants.filter((a) => a.invite);
  const skipping = result.applicants.filter((a) => !a.invite);
  const label = (a: { name: string | null; jobTitle: string | null }) =>
    `${a.name ?? "Applicant"}${a.jobTitle ? ` · ${a.jobTitle}` : ""}`;
  if (inviting.length === 0) {
    return refuse(
      `Nobody here can be invited: ${skipping.map((a) => ("message" in a ? a.message : "")).filter(Boolean).join(" ")}`.trim(),
    );
  }
  return preview(`Invite ${plural(inviting.length, "applicant", "applicants")} to the AI interview?`, [
    { label: "Inviting", value: names(inviting.map(label)) },
    skipping.length > 0 && {
      label: "Skipped",
      value: names(skipping.map((a) => `${label(a)}: ${"message" in a ? a.message : ""}`)),
    },
    {
      label: "Interview minutes",
      value: `Holds up to ${result.totalMinutes}, charged only for completed interviews. Each applicant gets an email with a link and a deadline.`,
    },
  ]);
};

/** The agent card's question for each role and team tool. */
const ROLE_SUMMARIES: Record<string, string> = {
  createRole: "Create this role?",
  updateRole: "Change this role?",
  deleteRole: "Delete this role?",
  assignRole: "Change this team member's role?",
  setDefaultRole: "Make this the default role for new invites?",
  removeTeamMember: "Remove this person from your team? They lose access right away.",
  assignToJob: "Add this team member to the job's hiring team?",
  unassignFromJob: "Remove this team member from the job's hiring team?",
  inviteTeamMember: "Invite this person to your team? They'll get an email with a link to join.",
  resendInvite: "Resend this invite? The old link stops working.",
  revokeInvite: "Revoke this invite? Its link stops working.",
};

/** The role and team tools, through the card's own preview (RP-REQ-032). */
const previewRole =
  (tool: Parameters<typeof previewAgentRole>[1]["tool"]): Builder =>
  async (ctx, input) => {
    const result = await previewAgentRole(ctx, { tool, input });
    if (!result.ok) return refuse(result.error);
    const changes = [
      ...(result.diff?.grants ?? []).map(describeGrantChange),
      ...(result.diff?.limits ?? []).map(describeLimitChange),
    ];
    return preview(ROLE_SUMMARIES[tool], [
      // The invitee's own address: the user typed it, and it's who gets the email.
      result.email && { label: "Email", value: result.email },
      result.role && { label: tool === "setDefaultRole" ? "New default" : "Role", value: result.role.name },
      result.to &&
        (tool === "updateRole" || tool === "assignRole") && {
          label: tool === "updateRole" ? "New name" : "New role",
          value: result.to,
        },
      result.member && { label: "Member", value: result.member },
      result.from && { label: tool === "setDefaultRole" ? "Current default" : "Current role", value: result.from },
      result.job && { label: "Job", value: result.job },
      tool === "deleteRole" && {
        label: "People moved",
        value: `${result.role?.members ?? 0}${result.replacement ? ` to ${result.replacement}` : ""}`,
      },
      changes.length > 0 && { label: "Permissions and limits", value: changes.join("; ") },
      tool === "updateRole" && changes.length === 0 && { label: "Permissions and limits", value: "Stay the same" },
      result.warning && { label: "Warning", value: result.warning },
    ]);
  };

// --- Jobs ------------------------------------------------------------------------

/** The job tools' camelCase fields, their labels and the columns they're stored in. */
const JOB_FIELDS = {
  title: { label: "Title", column: "title" },
  description: { label: "Description", column: "description" },
  locations: { label: "Locations", column: "location" },
  jobType: { label: "Job type", column: "job_type" },
  salaryCurrency: { label: "Salary currency", column: "salary_currency" },
  minSalary: { label: "Minimum salary", column: "min_salary" },
  maxSalary: { label: "Maximum salary", column: "max_salary" },
  minExperience: { label: "Minimum experience (years)", column: "min_experience" },
  maxExperience: { label: "Maximum experience (years)", column: "max_experience" },
  visaSponsorship: { label: "Visa sponsorship", column: "visa_sponsorship" },
  skills: { label: "Skills", column: "skills" },
  department: { label: "Department", column: "department" },
  workplaceType: { label: "Workplace", column: "workplace_type" },
  questions: { label: "Application form", column: "questions" },
  applicationForm: { label: "Application form", column: "application_form" },
} as const;

type JobField = keyof typeof JOB_FIELDS;

/** Fields that mark matches and screenings stale (updateJobPost's description). */
const MATCH_FIELDS: JobField[] = ["title", "description", "skills", "minExperience", "maxExperience"];

const formQuestions = (form: unknown) =>
  Array.isArray((form as { questions?: unknown })?.questions)
    ? (form as { questions: { archived?: boolean }[] }).questions.filter((q) => !q.archived).length
    : 0;

/** A field's value for a preview: long text by its length, forms by their questions. */
function fieldValue(field: JobField, value: unknown) {
  if (field === "description") return typeof value === "string" ? `${value.length} characters` : "not set";
  if (field === "questions") return plural(Array.isArray(value) ? value.length : 0, "question", "questions");
  if (field === "applicationForm") return plural(formQuestions(value), "question", "questions");
  return display(value);
}

const jobInputFields = (input: Input) =>
  (Object.keys(JOB_FIELDS) as JobField[]).filter((field) => input[field] !== undefined);

const previewCreateJob = gated("createJobPost", async (_ctx, input) =>
  preview("Create this job post as a draft? It isn't published until set_job_post_status publishes it, which counts toward the plan's active job post limit.", [
    ...jobInputFields(input)
      .filter((f) => !["salaryCurrency", "minSalary", "maxSalary"].includes(f))
      .map((field) => ({ label: JOB_FIELDS[field].label, value: fieldValue(field, input[field]) })),
    {
      label: "Salary",
      value:
        formatSalary(input.minSalary as number | undefined, input.maxSalary as number | undefined, str(input.salaryCurrency)) ??
        "Not shared",
    },
  ]),
);

const EDITABLE_COLUMNS =
  "id, title, description, location, job_type, salary_currency, min_salary, max_salary, min_experience, max_experience, visa_sponsorship, questions, application_form, skills, department, workplace_type";

const previewUpdateJob = gated("updateJobPost", async (ctx, input) => {
  const { data: job, error } = await ctx.supabase
    .from("job_postings")
    .select(EDITABLE_COLUMNS)
    .eq("id", str(input.jobPostId) ?? "")
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw error;
  if (!job) return refuse("Job posting not found.");
  const before = job as unknown as Record<string, unknown>;
  const fields = jobInputFields(input);
  const currentForm = readApplicationForm(job.application_form, job.questions);
  const stale = fields.some((f) => MATCH_FIELDS.includes(f));
  return preview(`Update the job post "${job.title}"?`, [
    ...fields.map((field) => {
      const from =
        field === "questions" || field === "applicationForm"
          ? plural(formQuestions(currentForm), "question", "questions")
          : fieldValue(field, before[JOB_FIELDS[field].column]);
      return { label: JOB_FIELDS[field].label, value: `${from} → ${fieldValue(field, input[field])}` };
    }),
    (fields.includes("questions") || fields.includes("applicationForm")) && {
      label: "Answered questions",
      value: "Stay on the job, archived",
    },
    stale && { label: "Note", value: "Existing matches and screenings for this job are marked stale." },
  ]);
});

const previewJobStatus = gated("setJobPostStatus", async (ctx, input) => {
  const { data: job, error } = await ctx.supabase
    .from("job_postings")
    .select("id, title, status")
    .eq("id", str(input.jobPostId) ?? "")
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw error;
  if (!job) return refuse("Job posting not found.");
  const publish = input.status === "active";
  const label = (status: string) => (status === "active" ? "Published" : "Not published");
  if (job.status === input.status) return refuse(`"${job.title}" is already ${publish ? "published" : "unpublished"}.`);
  return preview(publish ? "Publish this job post?" : "Unpublish this job post?", [
    { label: "Job", value: job.title },
    { label: "Status", value: `${label(job.status)} → ${label(String(input.status))}` },
    publish
      ? { label: "Plan", value: "Counts toward the plan's active job post limit. It's listed publicly and people can apply." }
      : { label: "Note", value: "It's taken off the public listings; its applications stay." },
  ]);
});

async function findQuestionSet(ctx: RecruiterToolContext, id: unknown) {
  const sets = await loadQuestionSets(ctx.supabase, ctx.company.id);
  if (!sets) throw new Error("Couldn't load the question sets.");
  return sets.find((s) => s.id === id) ?? null;
}

const QUESTION_SET_NOT_FOUND = "That question set isn't in your company.";

const previewApplyQuestionSet = gated("applyQuestionSet", async (ctx, input) => {
  const [set, { data: job, error }] = await Promise.all([
    findQuestionSet(ctx, input.questionSetId),
    ctx.supabase
      .from("job_postings")
      .select("id, title")
      .eq("id", str(input.jobPostId) ?? "")
      .eq("company_id", ctx.company.id)
      .maybeSingle(),
  ]);
  if (error) throw error;
  if (!job) return refuse("Job posting not found.");
  if (!set) return refuse(QUESTION_SET_NOT_FOUND);
  return preview("Apply this question set to the job? It replaces the job's application form; answered questions stay, archived.", [
    { label: "Job", value: job.title },
    { label: "Question set", value: set.name },
    { label: "Questions", value: String(formQuestions(set.form)) },
  ]);
});

const previewSaveQuestionSet = gated("saveQuestionSet", async (ctx, input) => {
  const jobPostId = str(input.jobPostId);
  if (jobPostId) {
    const denied = requireToolPermission(ctx, "jobs.view", jobPostId);
    if (denied) return refuse(denied.error);
  }
  const [existing, job] = await Promise.all([
    input.questionSetId ? findQuestionSet(ctx, input.questionSetId) : Promise.resolve(null),
    jobPostId
      ? ctx.supabase
          .from("job_postings")
          .select("id, title")
          .eq("id", jobPostId)
          .eq("company_id", ctx.company.id)
          .maybeSingle()
          .then(({ data, error }) => {
            if (error) throw error;
            return data;
          })
      : Promise.resolve(null),
  ]);
  if (input.questionSetId && !existing) return refuse(QUESTION_SET_NOT_FOUND);
  if (jobPostId && !job) return refuse("Job post not found.");
  return preview(existing ? "Overwrite this question set?" : "Save this question set?", [
    { label: "Name", value: str(input.name) ?? "" },
    existing && { label: "Overwrites", value: existing.name },
    {
      label: "Form",
      value: job
        ? `A copy of the application form of "${job.title}"`
        : plural(formQuestions(input.applicationForm), "question", "questions"),
    },
  ]);
});

const previewDeleteQuestionSet = gated("deleteQuestionSet", async (ctx, input) => {
  const set = await findQuestionSet(ctx, input.questionSetId);
  if (!set) return refuse(QUESTION_SET_NOT_FOUND);
  return preview("Delete this question set? Jobs it was applied to keep their copy.", [
    { label: "Question set", value: set.name },
  ]);
});

// --- Spending --------------------------------------------------------------------

async function companyJob(ctx: RecruiterToolContext, jobPostId: unknown, columns = "id, title") {
  const { data, error } = await ctx.supabase
    .from("job_postings")
    .select(columns)
    .eq("id", str(jobPostId) ?? "")
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as ({ id: string; title: string } & Record<string, unknown>) | null;
}

const previewRunMatching = gated("runMatchingForJob", async (ctx, input) => {
  const job = await companyJob(ctx, input.jobPostId, "id, title, matching_status");
  if (!job) return refuse("Job posting not found.");
  if (job.matching_status === "progress") return refuse("Matching is already in progress for this job.");
  return preview("Start matching candidates to this job? It runs in the background, and the company gets an email when it's done.", [
    { label: "Job", value: job.title },
    { label: "Uses", value: "AI processing; it counts toward the hourly limit on calls that use credits or allowances." },
  ]);
});

const previewScreenApplicants = gated("screenApplicants", async (ctx, input) => {
  const job = await companyJob(ctx, input.jobPostId);
  if (!job) return refuse("Job post not found.");
  const count = await countUnscreenedApplications(ctx.supabase, job.id);
  if (count === 0) return refuse("Every application to this job is already screened or being screened.");
  return preview("Screen this job's unscreened applicants? Each new screening uses one from your plan.", [
    { label: "Job", value: job.title },
    { label: "Applications to screen", value: String(count) },
    { label: "Uses", value: "One screening from the plan's monthly allowance for each new screening" },
  ]);
});

const previewConfigureInterview = gated("configureScreeningInterview", async (ctx, input) => {
  // The same two keys as saveInterviewConfigAction.
  const denied = requireToolPermission(ctx, "jobs.edit", str(input.jobPostId));
  if (denied) return refuse(denied.error);
  const job = await companyJob(ctx, input.jobPostId);
  if (!job) return refuse("Job post not found.");
  const competencies = (input.competencies ?? []) as { name: string; description: string }[];
  const questions = (input.questions ?? []) as string[];
  return preview("Set up this AI interview? Invites already sent keep their old setup.", [
    { label: "Job", value: job.title },
    { label: "Interview", value: input.enabled ? "On" : "Off" },
    {
      label: "Invites",
      value:
        input.inviteRule === "manual"
          ? "Only people you invite"
          : `Applicants scoring at least ${typeof input.fitThreshold === "number" ? input.fitThreshold : 70}`,
    },
    {
      label: "Competencies",
      value: competencies.map((c) => (c.description ? `${c.name} (${c.description})` : c.name)).join("; "),
    },
    { label: "Must-ask", value: questions.length > 0 ? questions.join("; ") : "None" },
    { label: "Length", value: `${display(input.durationMinutes)} minutes` },
    { label: "Deadline", value: `${display(input.deadlineDays)} days` },
  ]);
});

// --- Removals --------------------------------------------------------------------

async function candidateName(ctx: RecruiterToolContext, userId: string | null) {
  if (!userId) return null;
  const rows = await loadVisibleCandidates<{ user_id: string | null; full_name: string | null }>(
    ctx.supabase,
    [userId],
    "user_id, full_name",
  );
  return rows.get(userId)?.full_name?.trim() || null;
}

const previewWithdrawOutreach = gated("withdrawOutreach", async (ctx, input) => {
  const { data: outreach, error } = await ctx.supabase
    .from("candidate_outreach")
    .select("id, subject, status, sent_at, candidate_user_id, job_postings(title)")
    .eq("id", str(input.outreachId) ?? "")
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw error;
  if (!outreach) return refuse("Outreach not found.");
  if (outreach.status !== "sent") return refuse("Only an unanswered message can be withdrawn.");
  const name = await candidateName(ctx, outreach.candidate_user_id);
  return preview("Withdraw this message? The candidate won't be able to answer it, and this can't be undone.", [
    { label: "To", value: sandboxed("candidate_name", name ?? "Candidate") },
    { label: "Subject", value: outreach.subject },
    { label: "Job", value: outreach.job_postings?.title ?? "No job" },
    { label: "Sent", value: formatDate(outreach.sent_at) },
  ]);
});

const previewArchiveStage = gated("archiveStage", async (ctx, input) => {
  const stageId = str(input.stageId) ?? "";
  const { data: stage, error } = await ctx.supabase
    .from("pipeline_stages")
    .select("id, name, kind, archived")
    .eq("id", stageId)
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw error;
  if (!stage) return refuse("Stage not found.");
  if (PROTECTED_KINDS.has(stage.kind)) return refuse("The Applied, Hired and Rejected stages can't be archived.");
  if (stage.archived) return refuse(`"${stage.name}" is already archived.`);
  const { count, error: countError } = await ctx.supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stageId);
  if (countError) throw countError;
  if (count) return refuse(`Move the ${plural(count, "application", "applications")} out of "${stage.name}" first.`);
  return preview("Archive this stage? It leaves your pipeline and can't be brought back.", [
    { label: "Stage", value: stage.name },
  ]);
});

const previewDeleteTemplate = gated("deleteEmailTemplate", async (ctx, input) => {
  const { data: template, error } = await ctx.supabase
    .from("company_email_templates")
    .select("id, name, purpose, is_default")
    .eq("id", str(input.templateId) ?? "")
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw error;
  if (!template) return refuse("Template not found.");
  if (template.is_default) return refuse("Default templates can be edited but not deleted.");
  return preview("Delete this email template? This can't be undone.", [
    { label: "Template", value: template.name },
    { label: "Used for", value: statusText(template.purpose) },
  ]);
});

/** One of the user's own notes, with who it's about. */
async function ownNote(ctx: RecruiterToolContext, noteId: unknown) {
  const { data: note, error } = await ctx.supabase
    .from("candidate_notes")
    .select("id, body, rating, author_user_id, application_id, candidate_user_id")
    .eq("id", str(noteId) ?? "")
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw error;
  if (!note) return { ok: false as const, error: "Note not found." };
  if (note.author_user_id !== ctx.user.id) return { ok: false as const, error: "Only your own notes can be changed." };
  return { ok: true as const, note, about: await noteSubject(ctx, note) };
}

/** Who a note is (or would be) about: the application's person or a talent-pool candidate. */
async function noteSubject(
  ctx: RecruiterToolContext,
  target: { application_id?: string | null; candidate_user_id?: string | null },
) {
  if (target.application_id) {
    const { data, error } = await ctx.supabase
      .from("applications")
      .select(`id, applicant_user_id, company_candidate_id, user_info(full_name), ${COMPANY_CANDIDATE_PERSON_COLUMNS}, job_postings(title)`)
      .eq("id", target.application_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as unknown as Parameters<typeof applicationPersonOrNull>[0] & { job_postings: { title: string } | null };
    const person = applicationPersonOrNull(row);
    return `${person?.name ?? "Applicant"}${row.job_postings?.title ? ` · ${row.job_postings.title}` : ""}`;
  }
  return candidateName(ctx, target.candidate_user_id ?? null);
}

const ratingText = (rating: unknown) => (rating ? statusText(String(rating)) : "No rating");

const previewDeleteNote = gated("deleteNote", async (ctx, input) => {
  const found = await ownNote(ctx, input.noteId);
  if (!found.ok) return refuse(found.error);
  return preview("Delete this note? This can't be undone.", [
    { label: "About", value: sandboxed("candidate_name", found.about ?? "Candidate") },
    { label: "Note", value: sandboxed("note", found.note.body) },
  ]);
});

const previewDeleteTalentList = gated("deleteTalentList", async (ctx, input) => {
  const listId = str(input.listId) ?? "";
  const { data: list, error } = await ctx.supabase
    .from("talent_lists")
    .select("id, name")
    .eq("id", listId)
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw error;
  if (!list) return refuse("Talent list not found.");
  const { count } = await ctx.supabase
    .from("talent_list_members")
    .select("id", { count: "exact", head: true })
    .eq("list_id", listId);
  return preview("Delete this talent list? Its candidates stay in the talent pool, but the list can't be brought back.", [
    { label: "List", value: list.name },
    { label: "Candidates on it", value: String(count ?? 0) },
  ]);
});

// --- Careers page ----------------------------------------------------------------

const NO_CAREERS_PAGE =
  "The company doesn't have a careers page address yet. Claim one with set_careers_address, or open the careers page settings.";

async function myCareersPage(ctx: RecruiterToolContext): Promise<CareersPage | null> {
  const { data, error } = await ctx.supabase.rpc("get_my_careers_page");
  if (error) throw new Error(`get_my_careers_page failed: ${error.message}`);
  return toCareersPage(data);
}

const sectionTitle = (s: { kind: string; title?: string; hidden?: boolean }) =>
  `${s.kind === "about" ? "About" : (s.title ?? s.kind)}${s.hidden ? " (hidden)" : ""}`;

const previewUpdateCareers = gated("updateCareersPage", async (ctx, input) => {
  const page = await myCareersPage(ctx);
  if (!page) return refuse(NO_CAREERS_PAGE);
  const links = (input.links ?? {}) as Record<string, string | null | undefined>;
  return preview("Update your public careers page?", [
    { label: "Page", value: careersPath(page.slug) + (page.published ? " (published)" : " (not published)") },
    input.accentColor !== undefined && {
      label: "Accent colour",
      value: `${page.accentColor ?? "default"} → ${str(input.accentColor) ?? "default"}`,
    },
    input.coverUrl !== undefined && {
      label: "Cover",
      value: input.coverUrl === null ? "removed" : `${page.coverUrl ? "replaced" : "added"}: ${input.coverUrl}`,
    },
    Array.isArray(input.sections) && {
      label: "Sections",
      value: `${page.sections.map(sectionTitle).join(", ") || "none"} → ${(input.sections as { kind: string; title?: string; hidden?: boolean }[]).map(sectionTitle).join(", ") || "none"}`,
    },
    ...LINK_KEYS.filter((key) => key in links).map((key) => ({
      label: LINK_LABELS[key],
      value: `${page.links[key] ?? "none"} → ${links[key] ?? "removed"}`,
    })),
  ]);
});

const previewCareersAddress = gated("setCareersAddress", async (ctx, input) => {
  const page = await myCareersPage(ctx);
  const slug = str(input.slug)?.trim() ?? "";
  return preview(
    page
      ? `Change your careers page address to ${careersPath(slug)}? The old address will redirect for 90 days.`
      : `Claim ${careersPath(slug)} as your careers page address?`,
    [page && { label: "Current address", value: careersPath(page.slug) }, { label: "New address", value: careersPath(slug) }],
  );
});

const previewCareersPublished = gated("setCareersPublished", async (ctx, input) => {
  const page = await myCareersPage(ctx);
  if (!page) return refuse(NO_CAREERS_PAGE);
  const publish = input.published === true;
  if (page.published === publish) return refuse(`Your careers page is already ${publish ? "published" : "unpublished"}.`);
  return preview(publish ? "Publish your careers page?" : "Unpublish your careers page?", [
    { label: "Address", value: careersPath(page.slug) },
    {
      label: "Then",
      value: publish ? "Anyone can see it, with your active jobs." : "Its address shows nothing to the public.",
    },
  ]);
});

// --- Notes, import rows and the company's candidates (gated writes) ---------------

const previewAddNote = gated("addNote", async (ctx, input) => {
  const about = await noteSubject(ctx, {
    application_id: str(input.applicationId),
    candidate_user_id: str(input.candidateId),
  });
  if (!about) return refuse(input.applicationId ? "Application not found." : "This candidate isn't available.");
  return preview("Add this note for the hiring team?", [
    { label: "About", value: sandboxed("candidate_name", about) },
    { label: "Note", value: sandboxed("note", str(input.body) ?? "") },
    input.rating !== undefined && { label: "Rating", value: ratingText(input.rating) },
  ]);
});

const previewUpdateNote = gated("updateNote", async (ctx, input) => {
  const found = await ownNote(ctx, input.noteId);
  if (!found.ok) return refuse(found.error);
  return preview("Edit this note?", [
    { label: "About", value: sandboxed("candidate_name", found.about ?? "Candidate") },
    { label: "Note before", value: sandboxed("note", found.note.body) },
    { label: "Note after", value: sandboxed("note", str(input.body) ?? "") },
    input.rating !== undefined && {
      label: "Rating",
      value: `${ratingText(found.note.rating)} → ${ratingText(input.rating)}`,
    },
  ]);
});

/** The candidate fields the tools take, by label. Contact details are never shown, only that they change. */
const CANDIDATE_FIELDS: Record<string, string> = {
  full_name: "Name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  current_title: "Current title",
  current_company: "Current company",
  experience_years: "Years of experience",
  linkedin_url: "LinkedIn",
  github_url: "GitHub",
  portfolio_url: "Portfolio",
  skills: "Skills",
  tags: "Tags",
  notes: "Notes",
};
const CONTACT_FIELDS = new Set(["email", "phone", "linkedin_url", "github_url", "portfolio_url"]);

/** One line per changed field: before → after, contact details only as set, changed or cleared. */
function fieldDiff(before: Record<string, unknown>, changes: Record<string, unknown>): string[] {
  return Object.entries(changes)
    .filter(([field, value]) => value !== undefined && field in CANDIDATE_FIELDS)
    .map(([field, value]) => {
      const label = CANDIDATE_FIELDS[field];
      if (CONTACT_FIELDS.has(field)) {
        const had = before[field] !== undefined && before[field] !== null && before[field] !== "";
        return `${label}: ${value === null ? "cleared" : had ? "changed" : "added"}`;
      }
      return `${label}: ${display(before[field])} → ${value === null ? "cleared" : display(value)}`;
    });
}

/** The candidate's links as stored: `links` holds the profile URLs by field name. */
const candidateFieldsOf = (row: Record<string, unknown>) => ({
  ...((row.links ?? {}) as Record<string, unknown>),
  ...row,
});

const ROW_COLUMNS = "id, batch_id, file_name, row_number, status, error_code, extracted, edited, warnings, duplicate_of, duplicate_action, file_path";

async function importRows(ctx: RecruiterToolContext, ids: string[]) {
  const { data, error } = await ctx.supabase
    .from("candidate_import_rows")
    .select(ROW_COLUMNS)
    .eq("company_id", ctx.company.id)
    .in("id", ids);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, row]));
}

const rowLabel = (fields: Record<string, unknown>, fileName: string, rowNumber: number | null) =>
  str(fields.full_name)?.trim() || (rowNumber !== null ? `Row ${rowNumber}` : fileName);

const previewUpdateImportRows = gated("updateImportRows", async (ctx, input) => {
  const changes = (input.rows ?? []) as { rowId: string; fields?: Record<string, unknown>; duplicateAction?: DuplicateAction }[];
  const rows = await importRows(ctx, changes.map((c) => c.rowId));
  const found = changes.filter((c) => rows.has(c.rowId));
  if (found.length === 0) return refuse("None of these rows are in your imports.");
  const lines = found.map((change) => {
    const row = rows.get(change.rowId)!;
    const view = importRowView(row);
    const diff = [
      ...fieldDiff(view.fields, change.fields ?? {}),
      ...(change.duplicateAction
        ? [`If already a candidate: ${DUPLICATE_ACTION_LABELS[change.duplicateAction] ?? change.duplicateAction}`]
        : []),
    ];
    return `${rowLabel(view.fields, view.fileName, row.row_number)}: ${diff.join("; ") || "no change"}`;
  });
  const missing = changes.length - found.length;
  return preview(`Fix ${plural(found.length, "import row", "import rows")}?`, [
    // Row text comes from the person's resume or sheet.
    { label: "Changes", value: sandboxed("import_rows", lines.join("\n")) },
    missing > 0 && { label: "Not found", value: String(missing) },
  ]);
});

const previewRemoveImportRows = gated("removeImportRows", async (ctx, input) => {
  const ids = [...new Set((input.rowIds ?? []) as string[])];
  const rows = await importRows(ctx, ids);
  const found = ids.filter((id) => rows.has(id)).map((id) => rows.get(id)!);
  if (found.length === 0) return refuse("None of these rows are in your imports.");
  const withFiles = found.filter((row) => row.file_path).length;
  return preview(
    `Remove ${plural(found.length, "row", "rows")} from this import?${withFiles > 0 ? " A removed resume's file is deleted." : ""}`,
    [
      {
        label: "Rows",
        value: sandboxed(
          "import_rows",
          found.map((row) => rowLabel(importRowView(row).fields, row.file_name, row.row_number)).join("\n"),
        ),
      },
      withFiles > 0 && { label: "Resume files deleted", value: String(withFiles) },
      ids.length > found.length && { label: "Not found", value: String(ids.length - found.length) },
    ],
  );
});

const previewUpdateMyCandidate = gated("updateMyCandidate", async (ctx, input) => {
  const changes = (input.fields ?? {}) as Record<string, unknown>;
  if (changes.full_name === null) return refuse("A candidate needs a name.");
  const { data: candidate, error } = await ctx.supabase
    .from("company_candidates")
    .select("id, full_name, email, phone, location, current_title, current_company, experience_years, links, skills, tags, notes")
    .eq("id", str(input.candidateId) ?? "")
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw error;
  if (!candidate) return refuse("Candidate not found.");
  const diff = fieldDiff(candidateFieldsOf(candidate as unknown as Record<string, unknown>), changes);
  if (diff.length === 0) return refuse("Nothing to change.");
  return preview("Change these details of your candidate?", [
    { label: "Candidate", value: sandboxed("candidate_name", candidate.full_name) },
    // Tags and notes are replaced, and the old values are the candidate's words.
    { label: "Changes", value: sandboxed("candidate_changes", diff.join("\n")) },
  ]);
});

/** Every recruiter confirm row's preview, by MCP name (RMCP spec §4.6). */
export const RECRUITER_MCP_PREVIEWS: Readonly<Record<string, Builder>> = {
  // jobs
  create_job_post: previewCreateJob,
  update_job_post: previewUpdateJob,
  set_job_post_status: previewJobStatus,
  delete_job_post: gated("deleteJobPost", previewJobDelete),
  apply_question_set: previewApplyQuestionSet,
  save_question_set: previewSaveQuestionSet,
  delete_question_set: previewDeleteQuestionSet,
  // talent and applicants
  run_matching_for_job: previewRunMatching,
  screen_applicants: previewScreenApplicants,
  // pipeline
  archive_stage: previewArchiveStage,
  move_applications: gated("moveApplications", previewMove),
  add_note: previewAddNote,
  update_note: previewUpdateNote,
  delete_note: previewDeleteNote,
  // lists
  delete_talent_list: previewDeleteTalentList,
  // candidates
  add_candidates_to_job: gated("addCandidatesToJob", previewAddToJob),
  update_import_rows: previewUpdateImportRows,
  remove_import_rows: previewRemoveImportRows,
  confirm_import: gated("confirmImport", previewConfirmImport),
  add_candidate: gated("addCandidate", previewAddCandidate),
  update_my_candidate: previewUpdateMyCandidate,
  delete_my_candidates: gated("deleteMyCandidates", previewDeleteCandidates),
  // outreach
  send_outreach: gated("sendOutreach", previewOutreach),
  withdraw_outreach: previewWithdrawOutreach,
  delete_email_template: previewDeleteTemplate,
  // interviews
  configure_screening_interview: previewConfigureInterview,
  invite_to_interview: gated("inviteToInterview", previewInterviewInvite),
  // team
  create_role: gated("createRole", previewRole("createRole")),
  update_role: gated("updateRole", previewRole("updateRole")),
  delete_role: gated("deleteRole", previewRole("deleteRole")),
  assign_role: gated("assignRole", previewRole("assignRole")),
  set_default_role: gated("setDefaultRole", previewRole("setDefaultRole")),
  remove_team_member: gated("removeTeamMember", previewRole("removeTeamMember")),
  assign_to_job: gated("assignToJob", previewRole("assignToJob")),
  unassign_from_job: gated("unassignFromJob", previewRole("unassignFromJob")),
  invite_team_member: gated("inviteTeamMember", previewRole("inviteTeamMember")),
  resend_invite: gated("resendInvite", previewRole("resendInvite")),
  revoke_invite: gated("revokeInvite", previewRole("revokeInvite")),
  // careers
  update_careers_page: previewUpdateCareers,
  set_careers_address: previewCareersAddress,
  set_careers_published: previewCareersPublished,
};
