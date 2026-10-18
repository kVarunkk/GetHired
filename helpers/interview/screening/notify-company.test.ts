import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { sendEmail } from "@/utils/email";
import {
  interviewRecipientEmails,
  notifyCompanyOfCandidateResponse,
  completedUnscored,
  notifyCompanyOfCompletedInterview,
} from "./notify-company";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const JOB = "b0000000-0000-4000-8000-0000000000a1";
const AI = "fa000000-0000-4000-8000-000000000001";
const APP = "e0000000-0000-4000-8000-000000000001";
const OWNER = "c1000000-0000-4000-8000-000000000001";
const ALL = "c2000000-0000-4000-8000-000000000001";
const ASSIGNED = "c3000000-0000-4000-8000-000000000001";
const ELSEWHERE = "c4000000-0000-4000-8000-000000000001";
const NONE = "c5000000-0000-4000-8000-000000000001";

let service: SupabaseMock;
const getUserById = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  service = createSupabaseMock();
  (service.client.auth as unknown as { admin: unknown }).admin = { getUserById };
  getUserById.mockImplementation(async (id: string) => ({ data: { user: { id, email: `${id.slice(0, 2)}@acme.dev` } }, error: null }));
});

function queueTeam() {
  service.queue("company_members", {
    data: [
      { user_id: OWNER, is_owner: true, role_id: null },
      { user_id: ALL, is_owner: false, role_id: "r-all" },
      { user_id: ASSIGNED, is_owner: false, role_id: "r-assigned" },
      { user_id: ELSEWHERE, is_owner: false, role_id: "r-assigned" },
      { user_id: NONE, is_owner: false, role_id: "r-none" },
    ],
    error: null,
  });
  service.queue("company_role_permissions", {
    data: [
      { role_id: "r-all", scope: "all" },
      { role_id: "r-assigned", scope: "assigned" },
    ],
    error: null,
  });
  service.queue("company_job_assignments", { data: [{ user_id: ASSIGNED }], error: null });
}

describe("interviewRecipientEmails", () => {
  it("is owners and members with interviews.view on the job", async () => {
    queueTeam();
    expect((await interviewRecipientEmails(service.client, COMPANY, JOB)).sort()).toEqual(
      ["c1@acme.dev", "c2@acme.dev", "c3@acme.dev"].sort(),
    );
    expect(service.callsFor("company_role_permissions")[0].chain).toContainEqual({
      method: "eq",
      args: ["permission_key", "interviews.view"],
    });
    expect(service.callsFor("company_job_assignments")[0].chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB] });
  });
});

describe("notifyCompanyOfCandidateResponse (SI-REQ-016/026)", () => {
  function queueInterview(accommodation: string | null) {
    service.queue("application_interviews", {
      data: {
        id: AI,
        company_id: COMPANY,
        job_post_id: JOB,
        application_id: APP,
        applicant_user_id: "a1",
        accommodation_request: accommodation,
        config_snapshot: { job_title: "Backend Engineer", company_name: "Acme" },
      },
      error: null,
    });
    service.queue("user_info", { data: { full_name: "Priya Sharma" }, error: null });
    queueTeam();
  }

  it("sends the accommodation request to each recipient", async () => {
    queueInterview("I have a hearing impairment.");
    await notifyCompanyOfCandidateResponse(service.client, AI, "accommodation");

    expect(vi.mocked(sendEmail).mock.calls.map((c) => c[0].toEmail).sort()).toEqual(
      ["c1@acme.dev", "c2@acme.dev", "c3@acme.dev"].sort(),
    );
    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.subject).toBe("Priya Sharma asked for an alternative to the AI interview");
    expect(mail.textContent).toContain("I have a hearing impairment.");
    expect(mail.htmlContent).toContain(`/company/applicants/${APP}`);
  });

  it("sends the decline", async () => {
    queueInterview(null);
    await notifyCompanyOfCandidateResponse(service.client, AI, "declined");
    expect(vi.mocked(sendEmail).mock.calls[0][0].subject).toBe("Priya Sharma declined the AI interview");
  });
});

describe("notifyCompanyOfCompletedInterview (SI-REQ-030)", () => {
  function queueInterview() {
    service.queue("application_interviews", {
      data: {
        id: AI,
        company_id: COMPANY,
        job_post_id: JOB,
        application_id: APP,
        applicant_user_id: "a1",
        config_snapshot: { job_title: "Backend Engineer", company_name: "Acme" },
      },
      error: null,
    });
    service.queue("user_info", { data: { full_name: "Priya Sharma" }, error: null });
    queueTeam();
  }

  it("tells each recipient the report is ready", async () => {
    queueInterview();
    await notifyCompanyOfCompletedInterview(service.client, AI, { scored: true });

    expect(vi.mocked(sendEmail).mock.calls.map((c) => c[0].toEmail).sort()).toEqual(
      ["c1@acme.dev", "c2@acme.dev", "c3@acme.dev"].sort(),
    );
    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.subject).toBe("Priya Sharma finished the AI interview for Backend Engineer");
    expect(mail.textContent).toContain("The report is ready");
    expect(mail.htmlContent).toContain(`/company/applicants/${APP}`);
  });

  it("says when the interview was too short to score", async () => {
    queueInterview();
    await notifyCompanyOfCompletedInterview(service.client, AI, { scored: false });
    expect(vi.mocked(sendEmail).mock.calls[0][0].textContent).toContain("too short to score");
  });

  it("never throws", async () => {
    service.queue("application_interviews", { data: null, error: { message: "down" } });
    await expect(notifyCompanyOfCompletedInterview(service.client, AI, { scored: true })).resolves.toBeUndefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("completedUnscored", () => {
  it("is a just-recorded completion with no report queued", () => {
    expect(completedUnscored({ ok: true, status: "recorded", interview_status: "completed", analysis_id: null })).toBe(true);
    expect(completedUnscored({ ok: true, status: "recorded", interview_status: "completed", analysis_id: "a1" })).toBe(false);
    expect(completedUnscored({ ok: true, status: "recorded", interview_status: "invited", analysis_id: null })).toBe(false);
    expect(completedUnscored({ ok: true, status: "already_recorded", interview_status: "completed" })).toBe(false);
    expect(completedUnscored(null)).toBe(false);
  });
});
