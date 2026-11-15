import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, JOB_A1 } from "@/test/utils/team";
import type { CompanySessionContext } from "@/helpers/companies/company-session";
import { previewAgentScheduling } from "./preview-agent-scheduling";
import { loadLinkTemplates } from "./scheduler-calendar";

vi.mock("server-only", () => ({}));
vi.mock("./scheduler-calendar", () => ({ loadLinkTemplates: vi.fn() }));

const APP = "e0000000-0000-4000-8000-000000000001";
const INTERVIEW = "1e000000-0000-4000-8000-000000000001";
const PLAN_ITEM = "1a000000-0000-4000-8000-000000000001";
const STAGE = "90000000-0000-4000-8000-000000000002";
const ADA = "c1000000-0000-4000-8000-000000000002";
const BEN = "c1000000-0000-4000-8000-000000000003";
const TEAM = [
  { user_id: ADA, name: "Ada" },
  { user_id: BEN, name: "Ben" },
];

let db: SupabaseMock;
let session: CompanySessionContext;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: ADMIN_A.user });
  session = { supabase: db.client, company: ADMIN_A.myCompany, user: ADMIN_A.user };
});

const WRITES = new Set(["insert", "update", "upsert", "delete"]);
function expectNoWrites() {
  for (const call of db.calls) {
    for (const step of call.chain) expect(WRITES.has(step.method), `${call.target}.${step.method}`).toBe(false);
  }
  // Only reads: the claim form of interviewer_reminders is never called.
  for (const call of db.callsFor("interviewer_reminders")) {
    expect(call.chain[0].args[1]).toMatchObject({ p_claim: false });
  }
}

const application = (over: Record<string, unknown> = {}) => ({
  data: {
    id: APP,
    job_post_id: JOB_A1,
    user_info: { full_name: "Ada Lovelace" },
    company_candidates: null,
    job_postings: { title: "Backend Engineer" },
    ...over,
  },
  error: null,
});

describe("previewAgentScheduling (IVT-082)", () => {
  it("books: who, what, when, and that a candidate who can't be emailed gets no invite (D20)", async () => {
    db.queue("applications", application());
    db.queue("job_interview_plan_items", { data: { name: "System design", duration_minutes: 60 }, error: null });
    db.queueRpc("list_interviewer_options", { data: TEAM, error: null });
    db.queueRpc("interview_candidate_invitable", { data: false, error: null });

    const result = await previewAgentScheduling(session, "scheduleInterview", {
      applicationId: APP,
      planItemId: PLAN_ITEM,
      interviewerIds: [ADA, BEN],
      startsAt: "2026-11-20T10:00:00Z",
    });
    expect(result).toEqual({
      ok: true,
      rows: [
        { label: "Candidate", value: "Ada Lovelace" },
        { label: "Job", value: "Backend Engineer" },
        { label: "Interview", value: "System design · 60 min" },
        { label: "Interviewers", value: "Ada, Ben" },
        { label: "When", value: "2026-11-20T10:00:00Z", time: true },
      ],
      notices: [
        "Books it on your Google Calendar with a Meet link. Google emails the interviewers.",
        "This candidate won't get a calendar invite. Pass on the time and link yourself.",
      ],
    });
    expectNoWrites();
  });

  it("records without Google, emailing nobody", async () => {
    db.queue("applications", application({ company_candidates: { full_name: "Grace Hopper" } }));
    db.queueRpc("list_interviewer_options", { data: TEAM, error: null });
    const result = await previewAgentScheduling(session, "scheduleInterview", {
      applicationId: APP,
      name: "Coffee chat",
      durationMinutes: 30,
      interviewerIds: [ADA],
      startsAt: "2026-11-20T10:00:00Z",
      method: "record",
    });
    expect(result).toMatchObject({
      ok: true,
      rows: expect.arrayContaining([
        { label: "Candidate", value: "Grace Hopper" },
        { label: "Interview", value: "Coffee chat · 30 min" },
      ]),
      notices: ["Recorded only: no calendar event is created and nobody is emailed."],
    });
    expect(db.callsFor("interview_candidate_invitable")).toHaveLength(0);
  });

  it("refuses an application the member can't see", async () => {
    db.queue("applications", { data: null, error: null });
    expect(
      await previewAgentScheduling(session, "scheduleInterview", {
        applicationId: APP,
        name: "Chat",
        durationMinutes: 30,
        interviewerIds: [ADA],
        startsAt: "2026-11-20T10:00:00Z",
      }),
    ).toEqual({ ok: false, error: "Interview not found." });
  });

  it("names the link's email template, and warns when the candidate can't be emailed", async () => {
    db.queue("applications", application());
    db.queueRpc("list_interviewer_options", { data: TEAM, error: null });
    db.queueRpc("interview_candidate_invitable", { data: false, error: null });
    vi.mocked(loadLinkTemplates).mockResolvedValue([{ id: "t1", name: "Interview invite", subject: "", body: "" }]);
    const result = await previewAgentScheduling(session, "sendSchedulingLink", {
      applicationId: APP,
      name: "Chat",
      durationMinutes: 30,
      interviewerIds: [ADA],
    });
    expect(result).toMatchObject({
      ok: true,
      rows: expect.arrayContaining([{ label: "Email", value: "Interview invite" }]),
      warning: "This candidate can't be emailed, so the link can't be sent.",
    });
  });

  it("shows a reschedule's old and new time, and that Google emails the attendees", async () => {
    db.queue("scheduled_interviews", {
      data: {
        id: INTERVIEW,
        job_post_id: JOB_A1,
        application_id: APP,
        name: "System design",
        status: "scheduled",
        starts_at: "2026-11-20T10:00:00.000Z",
        provider_event_id: "evt",
        applications: { user_info: { full_name: "Ada Lovelace" }, company_candidates: null },
      },
      error: null,
    });
    const result = await previewAgentScheduling(session, "rescheduleInterview", {
      interviewId: INTERVIEW,
      startsAt: "2026-11-21T10:00:00Z",
    });
    expect(result).toEqual({
      ok: true,
      rows: [
        { label: "Candidate", value: "Ada Lovelace" },
        { label: "Interview", value: "System design" },
        { label: "Was", value: "2026-11-20T10:00:00.000Z", time: true },
        { label: "Moves to", value: "2026-11-21T10:00:00Z", time: true },
      ],
      notices: ["Google Calendar emails the attendees about the change."],
    });
  });

  it("says a cancelled link stops working", async () => {
    db.queue("scheduled_interviews", {
      data: {
        id: INTERVIEW,
        job_post_id: JOB_A1,
        application_id: APP,
        name: "Screen",
        status: "awaiting_candidate",
        starts_at: null,
        provider_event_id: null,
        applications: null,
      },
      error: null,
    });
    expect(await previewAgentScheduling(session, "cancelInterview", { interviewId: INTERVIEW })).toMatchObject({
      ok: true,
      notices: ["The candidate's scheduling link stops working. Nobody is emailed.", "The interviewers lose the interview kit."],
    });
  });

  it("lists who a reminder goes to, without claiming", async () => {
    db.queueRpc("interviewer_reminders", {
      data: {
        ok: true,
        application_id: APP,
        interview_name: "System design",
        job_title: "Backend Engineer",
        candidate_name: "Ada Lovelace",
        members: [
          { user_id: ADA, name: "Ada", state: "submitted" },
          { user_id: BEN, name: "Ben", state: "recent" },
        ],
      },
      error: null,
    });
    const result = await previewAgentScheduling(session, "remindInterviewers", { interviewId: INTERVIEW });
    expect(result).toMatchObject({
      ok: true,
      rows: expect.arrayContaining([
        { label: "Emails", value: "Nobody" },
        { label: "Not emailed", value: "Ada (submitted), Ben (reminded in the last 24 hours)" },
      ]),
      warning: "Nobody would be emailed.",
    });
    expectNoWrites();
  });

  it("shows the plan by stage and how many interviews it replaces", async () => {
    db.queue("job_postings", { data: { title: "Backend Engineer" }, error: null });
    db.queue("pipeline_stages", { data: [{ id: STAGE, name: "Onsite" }], error: null });
    db.queue("job_interview_plan_items", { data: null, count: 2, error: null } as never);
    const result = await previewAgentScheduling(session, "saveInterviewPlan", {
      jobPostId: JOB_A1,
      interviews: [
        {
          stageId: STAGE,
          name: "System design",
          durationMinutes: 60,
          competencies: [{ name: "Architecture" }, { name: "Communication" }],
        },
      ],
    });
    expect(result).toEqual({
      ok: true,
      rows: [
        { label: "Job", value: "Backend Engineer" },
        { label: "Onsite", value: "System design · 60 min · 2 competencies" },
      ],
      notices: ["Replaces the job's current plan (2 interviews). Interviews already scheduled keep their own copy."],
    });
    expectNoWrites();
  });

  it("can't read malformed input", async () => {
    expect(await previewAgentScheduling(session, "cancelInterview", { interviewId: "nope" })).toEqual({
      ok: false,
      error: "Couldn't read this request.",
    });
  });
});
