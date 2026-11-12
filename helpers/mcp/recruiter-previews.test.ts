/**
 * RMT-040–045: the recruiter confirm tools' previews (RMCP spec §4.6).
 *
 * Every builder: refuses without the tool's permission before reading
 * anything, only reads (no writes, no write RPCs, nothing consumed), never
 * shows a candidate's contact details, and keeps candidate-written text in a
 * sandbox. Each one's text carries the facts the agent's approval card shows:
 * the helper-backed ones format the helper's card data (mocked here; the
 * helpers are pinned in test/preview-helpers.test.ts and the actions' tests),
 * and the others read the database through the user's client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { JOB_A1, OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import { INJECTION_LINE } from "@/test/utils/matching";
import type { RecruiterToolContext } from "@/helpers/agent/roles/recruiter/tools";
import { RECRUITER_TOOL_PERMISSIONS, type RecruiterToolName } from "@/helpers/agent/roles/recruiter/tools/permissions";
import { RECRUITER_APPROVAL_POLICY } from "@/helpers/agent/roles/recruiter/approval";
import { assertAllowance, assertLimit, consumeEntitlement, holdEntitlement } from "@/helpers/billing/entitlements";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { formFromLegacyQuestions } from "@/helpers/jobs/application-form-schema";
import { previewAgentMove } from "@/helpers/pipeline/preview-agent-move";
import { previewAgentOutreach } from "@/helpers/outreach/preview-agent-outreach";
import { previewAgentJobDelete } from "@/helpers/jobs/preview-agent-job-delete";
import { previewAgentAddToJob } from "@/helpers/candidates/preview-agent-add-to-job";
import { previewAgentInterviewInvite } from "@/helpers/interview/screening/preview-agent-interview-invite";
import {
  previewAgentAddCandidate,
  previewAgentDeleteCandidates,
  previewAgentImport,
} from "@/helpers/candidates/preview-agent-import";
import { previewAgentRole } from "@/helpers/companies/preview-agent-role";
import { previewText, type McpPreview } from "./previews";
import { RECRUITER_MCP_PREVIEWS } from "./recruiter-previews";
import { RECRUITER_MCP_TOOLS } from "./recruiter-tools";
import { mcpToolFlags } from "./tools";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({
  getEntitlements: vi.fn(),
  assertAllowance: vi.fn(),
  assertLimit: vi.fn(),
  consumeEntitlement: vi.fn(),
  holdEntitlement: vi.fn(),
}));
vi.mock("@/helpers/pipeline/preview-agent-move", () => ({ previewAgentMove: vi.fn() }));
vi.mock("@/helpers/outreach/preview-agent-outreach", () => ({ previewAgentOutreach: vi.fn() }));
vi.mock("@/helpers/jobs/preview-agent-job-delete", () => ({ previewAgentJobDelete: vi.fn() }));
vi.mock("@/helpers/candidates/preview-agent-add-to-job", () => ({ previewAgentAddToJob: vi.fn() }));
vi.mock("@/helpers/interview/screening/preview-agent-interview-invite", () => ({
  previewAgentInterviewInvite: vi.fn(),
}));
vi.mock("@/helpers/candidates/preview-agent-import", () => ({
  previewAgentImport: vi.fn(),
  previewAgentAddCandidate: vi.fn(),
  previewAgentDeleteCandidates: vi.fn(),
}));
vi.mock("@/helpers/companies/preview-agent-role", () => ({ previewAgentRole: vi.fn() }));

const APP = "e0000000-0000-4000-8000-000000000001";
const APP_2 = "e0000000-0000-4000-8000-000000000002";
const STAGE = "90000000-0000-4000-8000-000000000002";
const NOTE = "a1000000-0000-4000-8000-000000000001";
const LIST = "a2000000-0000-4000-8000-000000000001";
const TEMPLATE = "a3000000-0000-4000-8000-000000000001";
const OUTREACH = "a4000000-0000-4000-8000-000000000001";
const SET = "a5000000-0000-4000-8000-000000000001";
const ROW = "a6000000-0000-4000-8000-000000000001";
const BATCH = "cb000000-0000-4000-8000-000000000001";
const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const CANDIDATE_2 = "cc000000-0000-4000-8000-000000000002";
const USER_CANDIDATE = "f0000000-0000-4000-8000-000000000001";
const ROLE = "70000000-0000-4000-8000-000000000001";
const MEMBER = "71000000-0000-4000-8000-000000000001";

// Candidate data planted in the fixtures: the name carries an injection, and
// the contact details must never reach a preview.
const NAME = `Meera ${INJECTION_LINE}`;
const EMAIL = "meera@example.com";
const PHONE = "+91 98765 43210";
const LINK = "https://linkedin.com/in/meera";
const CONTACT = [EMAIL, PHONE, LINK, "new@example.com", "+1 555 0100"];

const FORM = formFromLegacyQuestions(["Why us?", "Notice period?"]);
const JOB_ROW = { id: JOB_A1, title: "Frontend Engineer" };
const CAREERS_PAGE = {
  id: "ca000000-0000-4000-8000-000000000001",
  slug: "acme",
  published: false,
  name: "Acme",
  accent_color: "#112233",
  sections: [],
  links: {},
};
const IMPORT_ROW = {
  id: ROW,
  batch_id: BATCH,
  file_name: "meera.pdf",
  row_number: null,
  status: "parsed",
  error_code: null,
  extracted: { fields: { full_name: NAME, email: EMAIL, phone: PHONE, linkedin_url: LINK } },
  edited: null,
  warnings: [],
  duplicate_of: null,
  duplicate_action: null,
  file_path: "imports/meera.pdf",
};
const MY_NOTE = {
  id: NOTE,
  body: `Strong systems answers. ${INJECTION_LINE}`,
  rating: "yes",
  author_user_id: OWNER_A.user.id,
  application_id: APP,
  candidate_user_id: null,
};
const APPLICATION_PERSON = {
  id: APP,
  applicant_user_id: null,
  company_candidate_id: CANDIDATE,
  user_info: null,
  company_candidates: { id: CANDIDATE, full_name: NAME, email: EMAIL, resume_path: null },
  job_postings: { title: "Frontend Engineer" },
};

/** Read-only RPCs a preview may call. */
const READ_RPCS = ["application_job_id", "get_my_careers_page"];

let db: SupabaseMock;
const ctxFor = (member: MemberFixture): RecruiterToolContext => {
  db = createSupabaseMock({ user: member.user });
  return { supabase: db.client, user: member.user, company: member.myCompany, sessionId: null, surface: "mcp" };
};

/** Each application's job, for checkToolPermission. */
const appJobs = (n = 1) => {
  for (let i = 0; i < n; i++) db.queueRpc("application_job_id", { data: JOB_A1, error: null });
};

type Case = {
  tool: string;
  input: Record<string, unknown>;
  /** Queues the reads (and mocks the helper) for a good preview. */
  seed: () => void;
  /** Facts the text must state. */
  facts: RegExp[];
  /** Candidate-written text that must stay inside a sandbox. */
  sandboxed?: string;
  /** Contact details the user typed and the preview shows on purpose (team invites). */
  showsContact?: boolean;
  /** With nothing in the database, the preview refuses (a foreign or missing id). */
  foreign?: RegExp;
};

const ok = <T,>(value: T) => ({ ok: true as const, ...value });

const CASES: Case[] = [
  // --- helper-backed (RMT-041) ---
  {
    tool: "move_applications",
    input: { applicationIds: [APP], stageId: STAGE, email: { templateId: TEMPLATE } },
    seed: () => {
      appJobs();
      vi.mocked(previewAgentMove).mockResolvedValue(
        ok({
          stage: { id: STAGE, name: "Interview", kind: "interview" as const },
          applications: [{ id: APP, name: NAME, jobTitle: "Frontend Engineer", moves: true, emailed: true }],
          notFound: 1,
          email: { subject: "Next steps", body: `Hi ${NAME}, let's talk.`, recipients: 1 },
        }),
      );
    },
    facts: [
      /Move 1 application to Interview and email the candidates\?/,
      /Stage: Interview/,
      /Candidates see: \w+/,
      /Frontend Engineer/,
      /Skipped: 1 not found/,
      /Email: 1 candidate/,
      /Next steps/,
    ],
    sandboxed: NAME,
  },
  {
    tool: "send_outreach",
    input: { candidateId: USER_CANDIDATE, subject: "A role at Acme", message: "We'd love to talk." },
    seed: () =>
      vi.mocked(previewAgentOutreach).mockResolvedValue(
        ok({
          candidateName: NAME,
          acceptsOutreach: true,
          jobTitle: null,
          jobFound: true,
          openSince: "2026-10-20T00:00:00Z",
          quota: { remaining: 4, amount: 5 },
        }),
      ),
    facts: [
      /Send this message on GetHired\?/,
      /Job: No job/,
      /Uses 1 of 4 left this month \(of 5\)/,
      /haven't answered your message from 20 Oct/,
      /Subject: A role at Acme/,
      /Message: We'd love to talk\./,
    ],
    sandboxed: NAME,
  },
  {
    tool: "delete_job_post",
    input: { jobPostId: JOB_A1 },
    seed: () =>
      vi.mocked(previewAgentJobDelete).mockResolvedValue(ok({ title: "Frontend Engineer", status: "active", applications: 2 })),
    facts: [/The 2 applications and their notes are deleted too/, /Job: Frontend Engineer/, /Status: Published/],
  },
  {
    tool: "add_candidates_to_job",
    input: { jobPostId: JOB_A1, candidateIds: [CANDIDATE, CANDIDATE_2] },
    seed: () =>
      vi.mocked(previewAgentAddToJob).mockResolvedValue(
        ok({
          jobTitle: "Frontend Engineer",
          stageName: null,
          candidates: [
            { id: CANDIDATE, name: NAME, hasEmail: true },
            { id: CANDIDATE_2, name: "Ravi", hasEmail: false },
          ],
          notFound: 1,
        }),
      ),
    facts: [/Add 1 of your candidates to Frontend Engineer\? No one is emailed\./, /Stage: Its first stage/, /No email, won't be added: <candidate_names>\nRavi/, /Not found: 1/],
    sandboxed: NAME,
  },
  {
    tool: "confirm_import",
    input: { batchId: BATCH, jobPostId: JOB_A1, lawfulBasisNote: "Referral" },
    seed: () =>
      vi.mocked(previewAgentImport).mockResolvedValue(
        ok({
          kind: "resumes" as const,
          fileName: `resumes ${INJECTION_LINE}.zip`,
          importing: 3,
          known: 1,
          existing: 0,
          leftOut: 2,
          noEmailForJob: 0,
          missingEmail: 0,
          reading: 1,
          jobTitle: "Frontend Engineer",
          stageName: null,
          listName: "Backend",
          newList: true,
        }),
      ),
    facts: [
      /Import these people\? No one is emailed\./,
      /Into: your candidates, a new list, Backend, Frontend Engineer \(its first stage\)/,
      /Importing: 3 people/,
      /Already on GetHired \(linked, not imported again\): 1/,
      /Left out \(needs a fix, failed or a repeat\): 2/,
      /Still being read, not included: 1/,
      /lawful basis to process these people's data.*\(Referral\)/,
    ],
    sandboxed: INJECTION_LINE,
  },
  {
    tool: "add_candidate",
    input: { full_name: "Asha Rao", talentListId: LIST, lawfulBasisNote: "Referral" },
    seed: () =>
      vi.mocked(previewAgentAddCandidate).mockResolvedValue(
        ok({ name: "Asha Rao", jobTitle: null, stageName: null, listName: "Backend", newList: false }),
      ),
    facts: [/Add Asha Rao to your candidates\? No one is emailed\./, /Into: your candidates, the list Backend/, /\(Referral\)/],
  },
  {
    tool: "delete_my_candidates",
    input: { candidateIds: [CANDIDATE] },
    seed: () =>
      vi.mocked(previewAgentDeleteCandidates).mockResolvedValue(ok({ candidates: [{ id: CANDIDATE, name: NAME, jobs: 2 }], notFound: 0 })),
    facts: [/Delete this candidate\?.*can't be undone/, /in 2 jobs/],
    sandboxed: NAME,
  },
  {
    tool: "invite_to_interview",
    input: { applicationIds: [APP, APP_2] },
    seed: () => {
      appJobs(2);
      vi.mocked(previewAgentInterviewInvite).mockResolvedValue(
        ok({
          applicants: [
            { id: APP, name: NAME, jobTitle: "Frontend Engineer", invite: true as const, minutes: 15 },
            { id: APP_2, name: "Ravi", jobTitle: "Frontend Engineer", invite: false as const, message: "Already invited." },
          ],
          totalMinutes: 15,
        }),
      );
    },
    facts: [/Invite 1 applicant to the AI interview\?/, /Ravi · Frontend Engineer: Already invited\./, /Holds up to 15, charged only for completed interviews/],
    sandboxed: NAME,
  },
  {
    tool: "update_role",
    input: { roleId: ROLE, name: "Lead", grants: ["jobs.edit"] },
    seed: () =>
      vi.mocked(previewAgentRole).mockResolvedValue({
        ok: true,
        role: { name: "Recruiter", members: 2 },
        diff: { grants: [{ kind: "added", key: "jobs.edit", label: "Edit jobs", scope: "all" }], limits: [] },
        replacement: null,
        member: null,
        from: null,
        to: "Lead",
        job: null,
        email: null,
        warning: "This is your own role: its permissions and limits can't be changed by you.",
      }),
    facts: [/Change this role\?/, /Role: Recruiter/, /New name: Lead/, /\+ Edit jobs \(all jobs\)/, /Warning: This is your own role/],
  },
  {
    tool: "invite_team_member",
    input: { email: "sam@acme.test" },
    seed: () =>
      vi.mocked(previewAgentRole).mockResolvedValue({
        ok: true,
        role: { name: "Member", members: 0 },
        diff: null,
        replacement: null,
        member: null,
        from: null,
        to: null,
        job: null,
        email: "sam@acme.test",
        warning: null,
      }),
    facts: [/Invite this person to your team\? They'll get an email/, /Email: sam@acme\.test/, /Role: Member/],
    showsContact: true,
  },
  ...(
    [
      ["create_role", { name: "Coordinator", grants: [] }, /Create this role\?/],
      ["delete_role", { roleId: ROLE }, /Delete this role\?[\s\S]*People moved: 0/],
      ["assign_role", { memberId: MEMBER, roleId: ROLE }, /Change this team member's role\?[\s\S]*Member: Sam/],
      ["set_default_role", { roleId: ROLE }, /Make this the default role for new invites\?/],
      ["remove_team_member", { memberId: MEMBER }, /They lose access right away[\s\S]*Member: Sam/],
      ["assign_to_job", { memberId: MEMBER, jobPostId: JOB_A1 }, /Add this team member to the job's hiring team\?/],
      ["unassign_from_job", { memberId: MEMBER, jobPostId: JOB_A1 }, /Remove this team member from the job's hiring team\?/],
      ["resend_invite", { inviteId: ROLE }, /Resend this invite\? The old link stops working\./],
      ["revoke_invite", { inviteId: ROLE }, /Revoke this invite\? Its link stops working\./],
    ] as const
  ).map(
    ([tool, input, fact]): Case => ({
      tool,
      input,
      seed: () =>
        vi.mocked(previewAgentRole).mockResolvedValue({
          ok: true,
          role: { name: "Member", members: 0 },
          diff: null,
          replacement: null,
          member: "Sam",
          from: null,
          to: null,
          job: "Frontend Engineer",
          email: null,
          warning: null,
        }),
      facts: [fact],
    }),
  ),

  // --- jobs (RMT-042) ---
  {
    tool: "create_job_post",
    input: {
      title: "Backend Engineer",
      description: "Build APIs.",
      locations: ["Remote"],
      jobType: "Fulltime",
      salaryCurrency: "$",
      minSalary: 100,
      maxSalary: 200,
      minExperience: 3,
      visaSponsorship: "Not Required",
    },
    seed: () => undefined,
    facts: [/as a draft\?.*active job post limit/, /Title: Backend Engineer/, /Locations: Remote/, /Salary: \$100–\$200/, /Description: 11 characters/],
  },
  {
    tool: "update_job_post",
    input: { jobPostId: JOB_A1, title: "Senior Frontend Engineer", skills: ["React", "TypeScript"] },
    seed: () =>
      db.queue("job_postings", {
        data: { ...JOB_ROW, description: "x", location: ["Pune"], skills: ["React"], questions: [], application_form: null },
        error: null,
      }),
    facts: [
      /Update the job post "Frontend Engineer"\?/,
      /Title: Frontend Engineer → Senior Frontend Engineer/,
      /Skills: React → React, TypeScript/,
      /matches and screenings for this job are marked stale/,
    ],
    foreign: /Job posting not found/,
  },
  {
    tool: "set_job_post_status",
    input: { jobPostId: JOB_A1, status: "active" },
    seed: () => db.queue("job_postings", { data: { ...JOB_ROW, status: "inactive" }, error: null }),
    facts: [/Publish this job post\?/, /Status: Not published → Published/, /active job post limit/],
    foreign: /Job posting not found/,
  },
  {
    tool: "apply_question_set",
    input: { jobPostId: JOB_A1, questionSetId: SET },
    seed: () => {
      db.queue("company_question_sets", { data: [{ id: SET, name: "Engineering", form: FORM, updated_at: "2026-10-01" }], error: null });
      db.queue("job_postings", { data: JOB_ROW, error: null });
    },
    facts: [/replaces the job's application form/, /Job: Frontend Engineer/, /Question set: Engineering/, /Questions: 2/],
    foreign: /not found|isn't in your company/,
  },
  {
    tool: "save_question_set",
    input: { name: "Engineering", jobPostId: JOB_A1 },
    seed: () => db.queue("job_postings", { data: JOB_ROW, error: null }),
    facts: [/Save this question set\?/, /Name: Engineering/, /A copy of the application form of "Frontend Engineer"/],
    foreign: /Job post not found/,
  },
  {
    tool: "delete_question_set",
    input: { questionSetId: SET },
    seed: () =>
      db.queue("company_question_sets", { data: [{ id: SET, name: "Engineering", form: FORM, updated_at: "2026-10-01" }], error: null }),
    facts: [/Jobs it was applied to keep their copy/, /Question set: Engineering/],
    foreign: /isn't in your company/,
  },

  // --- spending (RMT-043) ---
  {
    tool: "run_matching_for_job",
    input: { jobPostId: JOB_A1 },
    seed: () => db.queue("job_postings", { data: { ...JOB_ROW, matching_status: "completed" }, error: null }),
    facts: [/Start matching candidates to this job\?/, /Job: Frontend Engineer/, /hourly limit on calls that use credits/],
    foreign: /Job posting not found/,
  },
  {
    tool: "screen_applicants",
    input: { jobPostId: JOB_A1 },
    seed: () => {
      db.queue("job_postings", { data: JOB_ROW, error: null });
      db.queue("applications", { data: [{ id: APP }, { id: APP_2 }], error: null });
      db.queue("application_screenings", { data: [{ application_id: APP, status: "completed" }], error: null });
    },
    facts: [/Each new screening uses one from your plan/, /Job: Frontend Engineer/, /Applications to screen: 1/],
    foreign: /Job post not found/,
  },
  {
    tool: "configure_screening_interview",
    input: {
      jobPostId: JOB_A1,
      enabled: true,
      inviteRule: "fit_threshold",
      fitThreshold: 75,
      questions: ["Tell me about a migration you led."],
      competencies: [{ name: "System design", description: "Designs services that scale." }],
      durationMinutes: 15,
      deadlineDays: 7,
    },
    seed: () => db.queue("job_postings", { data: JOB_ROW, error: null }),
    facts: [
      /Set up this AI interview\?/,
      /Interview: On/,
      /Applicants scoring at least 75/,
      /System design \(Designs services that scale\.\)/,
      /Must-ask: Tell me about a migration you led\./,
      /Length: 15 minutes/,
      /Deadline: 7 days/,
    ],
    foreign: /Job post not found/,
  },

  // --- removals (RMT-044) ---
  {
    tool: "withdraw_outreach",
    input: { outreachId: OUTREACH },
    seed: () => {
      db.queue("candidate_outreach", {
        data: {
          id: OUTREACH,
          subject: "A role at Acme",
          status: "sent",
          sent_at: "2026-10-20T00:00:00Z",
          candidate_user_id: USER_CANDIDATE,
          job_postings: { title: "Frontend Engineer" },
        },
        error: null,
      });
      db.queue("candidate_directory", { data: [{ user_id: USER_CANDIDATE, full_name: NAME }], error: null });
    },
    facts: [/Withdraw this message\?/, /Subject: A role at Acme/, /Job: Frontend Engineer/, /Sent: 20 Oct 2026/],
    sandboxed: NAME,
    foreign: /Outreach not found/,
  },
  {
    tool: "archive_stage",
    input: { stageId: STAGE },
    seed: () => {
      db.queue("pipeline_stages", { data: { id: STAGE, name: "Take-home", kind: "interview", archived: false }, error: null });
      db.queue("applications", { data: null, error: null, count: 0 });
    },
    facts: [/Archive this stage\?/, /Stage: Take-home/],
    foreign: /Stage not found/,
  },
  {
    tool: "delete_email_template",
    input: { templateId: TEMPLATE },
    seed: () =>
      db.queue("company_email_templates", { data: { id: TEMPLATE, name: "Nudge", purpose: "advance", is_default: false }, error: null }),
    facts: [/Delete this email template\?/, /Template: Nudge/, /Used for: Advance/],
    foreign: /Template not found/,
  },
  {
    tool: "delete_note",
    input: { noteId: NOTE },
    seed: () => {
      db.queue("candidate_notes", { data: { application_id: APP }, error: null });
      appJobs();
      db.queue("candidate_notes", { data: MY_NOTE, error: null });
      db.queue("applications", { data: APPLICATION_PERSON, error: null });
    },
    facts: [/Delete this note\?/, /About: <candidate_name>/, /Frontend Engineer/, /Note: <note>\nStrong systems answers/],
    sandboxed: INJECTION_LINE,
    foreign: /Note not found/,
  },
  {
    tool: "delete_talent_list",
    input: { listId: LIST },
    seed: () => {
      db.queue("talent_lists", { data: { id: LIST, name: "Shortlist" }, error: null });
      db.queue("talent_list_members", { data: null, error: null, count: 3 });
    },
    facts: [/Its candidates stay in the talent pool/, /List: Shortlist/, /Candidates on it: 3/],
    foreign: /Talent list not found/,
  },
  {
    tool: "update_careers_page",
    input: { accentColor: "#445566", links: { linkedin: "https://linkedin.com/company/acme" } },
    seed: () => db.queueRpc("get_my_careers_page", { data: CAREERS_PAGE, error: null }),
    facts: [/Update your public careers page\?/, /Page: \/careers\/acme \(not published\)/, /Accent colour: #112233 → #445566/, /LinkedIn: none → https:\/\/linkedin\.com\/company\/acme/],
    foreign: /doesn't have a careers page address yet/,
  },
  {
    tool: "set_careers_address",
    input: { slug: "acme-jobs" },
    seed: () => db.queueRpc("get_my_careers_page", { data: CAREERS_PAGE, error: null }),
    facts: [/Change your careers page address to \/careers\/acme-jobs\? The old address will redirect for 90 days\./, /Current address: \/careers\/acme/],
  },
  {
    tool: "set_careers_published",
    input: { published: true },
    seed: () => db.queueRpc("get_my_careers_page", { data: CAREERS_PAGE, error: null }),
    facts: [/Publish your careers page\?/, /Address: \/careers\/acme/],
    foreign: /doesn't have a careers page address yet/,
  },

  // --- gated writes and import rows (RMT-045) ---
  {
    tool: "add_note",
    input: { applicationId: APP, body: "Clear on trade-offs.", rating: "strong_yes" },
    seed: () => {
      appJobs();
      db.queue("applications", { data: APPLICATION_PERSON, error: null });
    },
    facts: [/Add this note for the hiring team\?/, /Note: <note>\nClear on trade-offs\./, /Rating: Strong yes/],
    sandboxed: NAME,
  },
  {
    tool: "update_note",
    input: { noteId: NOTE, body: "Clear on trade-offs.", rating: null },
    seed: () => {
      db.queue("candidate_notes", { data: { application_id: APP }, error: null });
      appJobs();
      db.queue("candidate_notes", { data: MY_NOTE, error: null });
      db.queue("applications", { data: APPLICATION_PERSON, error: null });
    },
    facts: [/Edit this note\?/, /Note before: <note>\nStrong systems answers/, /Note after: <note>\nClear on trade-offs\./, /Rating: Yes → No rating/],
    sandboxed: INJECTION_LINE,
    foreign: /Note not found/,
  },
  {
    tool: "update_import_rows",
    input: { rows: [{ rowId: ROW, fields: { email: "new@example.com", current_title: "SRE" }, duplicateAction: "fill" }] },
    seed: () => db.queue("candidate_import_rows", { data: [IMPORT_ROW], error: null }),
    facts: [/Fix 1 import row\?/, /Email: changed/, /Current title: not set → SRE/, /If already a candidate: /],
    sandboxed: NAME,
    foreign: /None of these rows are in your imports/,
  },
  {
    tool: "remove_import_rows",
    input: { rowIds: [ROW] },
    seed: () => db.queue("candidate_import_rows", { data: [IMPORT_ROW], error: null }),
    facts: [/Remove 1 row from this import\? A removed resume's file is deleted\./, /Resume files deleted: 1/],
    sandboxed: NAME,
    foreign: /None of these rows are in your imports/,
  },
  {
    tool: "update_my_candidate",
    input: { candidateId: CANDIDATE, fields: { location: "Mumbai", phone: "+1 555 0100", tags: ["backend"] } },
    seed: () =>
      db.queue("company_candidates", {
        data: {
          id: CANDIDATE,
          full_name: NAME,
          email: EMAIL,
          phone: PHONE,
          location: "Pune",
          current_title: null,
          current_company: null,
          experience_years: 4,
          links: { linkedin_url: LINK },
          skills: [],
          tags: ["referral"],
          notes: null,
        },
        error: null,
      }),
    facts: [/Change these details of your candidate\?/, /Location: Pune → Mumbai/, /Phone: changed/, /Tags: referral → backend/],
    sandboxed: NAME,
    foreign: /Candidate not found/,
  },
];

const textOf = (preview: McpPreview) => (preview.ok ? previewText(preview) : preview.error);

/** The text with every sandboxed block removed. */
const outsideSandboxes = (text: string) => text.replace(/<([a-z_]+)>[\s\S]*?<\/\1>/g, "");

const confirmRows = RECRUITER_MCP_TOOLS.filter((def) => mcpToolFlags(def, RECRUITER_APPROVAL_POLICY).confirm);

beforeEach(() => vi.clearAllMocks());

describe("the catalog's previews (RMT-040)", () => {
  it("has a case here for every confirm row, and a builder for exactly those", () => {
    expect(CASES.map((c) => c.tool).sort()).toEqual(confirmRows.map((def) => def.name).sort());
    expect(Object.keys(RECRUITER_MCP_PREVIEWS).sort()).toEqual(confirmRows.map((def) => def.name).sort());
  });

  it("gives each confirm row its builder, and no other row a preview", () => {
    for (const def of RECRUITER_MCP_TOOLS) {
      expect(def.preview, def.name).toBe(RECRUITER_MCP_PREVIEWS[def.name]);
    }
  });
});

describe.each(CASES)("$tool", ({ tool, input, seed, facts, sandboxed, showsContact, foreign }) => {
  const build = RECRUITER_MCP_PREVIEWS[tool];
  const agentTool = RECRUITER_MCP_TOOLS.find((def) => def.name === tool)!.agentTools[0] as RecruiterToolName;

  it("states what the agent's approval card shows", async () => {
    const ctx = ctxFor(OWNER_A);
    seed();
    const preview = await build(ctx, input);

    expect(preview.ok, textOf(preview)).toBe(true);
    const text = textOf(preview);
    for (const fact of facts) expect(text).toMatch(fact);
  });

  it("only reads, and spends nothing", async () => {
    const ctx = ctxFor(OWNER_A);
    seed();
    await build(ctx, input);

    for (const call of db.calls) {
      if (call.kind === "rpc") expect(READ_RPCS, call.target).toContain(call.target);
      const writes = call.chain.filter((step) => ["insert", "update", "upsert", "delete"].includes(step.method));
      expect(writes, call.target).toEqual([]);
    }
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(holdEntitlement).not.toHaveBeenCalled();
    expect(assertAllowance).not.toHaveBeenCalled();
    expect(assertLimit).not.toHaveBeenCalled();
  });

  it("shows no contact details, and sandboxes candidate text", async () => {
    const ctx = ctxFor(OWNER_A);
    seed();
    const text = textOf(await build(ctx, input));

    if (!showsContact) {
      for (const detail of CONTACT) expect(text).not.toContain(detail);
      expect(text).not.toMatch(/@/);
    }
    if (sandboxed) {
      expect(text).toContain(sandboxed);
      expect(outsideSandboxes(text)).not.toContain(sandboxed);
    }
  });

  it("refuses without the tool's permission, before reading anything", async () => {
    const ctx = ctxFor(memberWith(["mcp.use"]));
    const preview = await build(ctx, input);

    const key = RECRUITER_TOOL_PERMISSIONS[agentTool].keys[0];
    expect(preview).toEqual({ ok: false, error: forbiddenMessage(key) });
    expect(db.calls).toEqual([]);
  });

  if (foreign) {
    it("refuses an id that isn't the company's", async () => {
      const ctx = ctxFor(OWNER_A);
      // Only what the permission check reads; the preview's own reads find nothing.
      if (["delete_note", "update_note"].includes(tool)) {
        db.queue("candidate_notes", { data: { application_id: APP }, error: null });
        appJobs();
      }
      const preview = await build(ctx, input);

      expect(preview).toMatchObject({ ok: false, error: expect.stringMatching(foreign) });
    });
  }
});

describe("refusals that match the run", () => {
  it("a job post the member isn't assigned to is refused for its job", async () => {
    const ctx = ctxFor(memberWith(["mcp.use", { key: "jobs.edit", scope: "assigned" }], { assignedJobIds: [] }));

    const preview = await RECRUITER_MCP_PREVIEWS.update_job_post(ctx, { jobPostId: JOB_A1, title: "x" });

    expect(preview).toEqual({ ok: false, error: forbiddenMessage("jobs.edit", { forJob: true }) });
    expect(db.calls).toEqual([]);
  });

  it("a teammate's note can't be changed", async () => {
    const ctx = ctxFor(OWNER_A);
    db.queue("candidate_notes", { data: { application_id: APP }, error: null });
    appJobs();
    db.queue("candidate_notes", { data: { ...MY_NOTE, author_user_id: "someone-else" }, error: null });

    const preview = await RECRUITER_MCP_PREVIEWS.update_note(ctx, { noteId: NOTE, body: "x" });

    expect(preview).toEqual({ ok: false, error: "Only your own notes can be changed." });
  });

  it("a live matching run is refused, and a dead one previews as restartable (SM-TEST-005)", async () => {
    const ctx = ctxFor(OWNER_A);
    const now = new Date().toISOString();
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    db.queue("job_postings", {
      data: { ...JOB_ROW, matching_status: "progress", matching_started_at: now, updated_at: now },
      error: null,
    });
    expect(await RECRUITER_MCP_PREVIEWS.run_matching_for_job(ctx, { jobPostId: JOB_A1 })).toEqual({
      ok: false,
      error: "Matching is already in progress for this job.",
    });

    // An edit since doesn't make a dead run look alive: the start counts.
    db.queue("job_postings", {
      data: { ...JOB_ROW, matching_status: "progress", matching_started_at: longAgo, updated_at: now },
      error: null,
    });
    expect(await RECRUITER_MCP_PREVIEWS.run_matching_for_job(ctx, { jobPostId: JOB_A1 })).toMatchObject({ ok: true });
  });

  it("a status that's already set isn't asked about", async () => {
    const ctx = ctxFor(OWNER_A);
    db.queue("job_postings", { data: { ...JOB_ROW, status: "active" }, error: null });

    const preview = await RECRUITER_MCP_PREVIEWS.set_job_post_status(ctx, { jobPostId: JOB_A1, status: "active" });

    expect(preview).toEqual({ ok: false, error: '"Frontend Engineer" is already published.' });
  });

  it("a stage with applications in it can't be archived", async () => {
    const ctx = ctxFor(OWNER_A);
    db.queue("pipeline_stages", { data: { id: STAGE, name: "Take-home", kind: "interview", archived: false }, error: null });
    db.queue("applications", { data: null, error: null, count: 2 });

    const preview = await RECRUITER_MCP_PREVIEWS.archive_stage(ctx, { stageId: STAGE });

    expect(preview).toEqual({ ok: false, error: 'Move the 2 applications out of "Take-home" first.' });
  });

  it("an import with resumes missing an email for a job is refused, as the confirm would", async () => {
    const ctx = ctxFor(OWNER_A);
    vi.mocked(previewAgentImport).mockResolvedValue(
      ok({
        kind: "resumes" as const,
        fileName: null,
        importing: 2,
        known: 0,
        existing: 0,
        leftOut: 0,
        noEmailForJob: 0,
        missingEmail: 2,
        reading: 0,
        jobTitle: "Frontend Engineer",
        stageName: null,
        listName: null,
        newList: false,
      }),
    );

    const preview = await RECRUITER_MCP_PREVIEWS.confirm_import(ctx, { batchId: BATCH, jobPostId: JOB_A1 });

    expect(preview).toMatchObject({ ok: false, error: expect.stringMatching(/2 resumes have no email/) });
  });

  it("passes a helper's refusal through", async () => {
    const ctx = ctxFor(OWNER_A);
    vi.mocked(previewAgentJobDelete).mockResolvedValue({ ok: false, error: "Job posting not found." });

    const preview = await RECRUITER_MCP_PREVIEWS.delete_job_post(ctx, { jobPostId: JOB_A1 });

    expect(preview).toEqual({ ok: false, error: "This delete won't go through: Job posting not found." });
  });
});
