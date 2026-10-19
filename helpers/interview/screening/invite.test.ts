import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { flushAfter } from "@/test/utils/after";
import { ADMIN_A } from "@/test/utils/team";
import { MAX_BULK_INVITES, inviteApplicants, inviteCostPreview, sendInterviewInviteEmail } from "./invite";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));

const JOB = "b0000000-0000-4000-8000-0000000000a1";
const app = (n: number) => `e0000000-0000-4000-8000-00000000000${n}`;
const ai = (n: number) => `fa000000-0000-4000-8000-00000000000${n}`;

const snapshot = {
  questions: [{ text: "Secret question" }],
  competencies: [{ name: "System design", description: "Secret rubric" }],
  duration_minutes: 15,
  deadline_days: 5,
  language: "en",
  company_name: "Acme",
  job_title: "Backend Engineer",
};

let session: SupabaseMock;
let service: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  session = createSupabaseMock();
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
});

const deps = () => ({ supabase: session.client, company: ADMIN_A.myCompany, user: ADMIN_A.user });

/** The session's view of the applications (RLS). */
function queueVisible(ids: string[]) {
  session.queue("applications", { data: ids.map((id) => ({ id })), error: null });
}

const bulkCalls = () => service.callsFor("create_screening_invites").map((c) => c.chain[0].args[1]);

describe("inviteApplicants (SI-REQ-010/012/013, SI-TEST-002)", () => {
  it("invites the visible applications in one create_screening_invites call as the session user", async () => {
    queueVisible([app(1), app(2)]);
    service.queueRpc("create_screening_invites", {
      data: [
        { application_id: app(1), ok: true, id: ai(1) },
        { application_id: app(2), ok: false, reason: "exists" },
      ],
      error: null,
    });

    const result = await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: [app(1), app(2)], via: "manual" });

    expect(result).toEqual({
      ok: true,
      invited: [{ id: ai(1), applicationId: app(1) }],
      skipped: [{ id: app(2), reason: "exists" }],
    });
    expect(bulkCalls()).toEqual([
      { p_job_post_id: JOB, p_application_ids: [app(1), app(2)], p_via: "manual", p_invited_by: ADMIN_A.user.id },
    ]);
  });

  it("passes every refusal reason through", async () => {
    const reasons = ["disabled", "job_inactive", "closed", "insufficient_credits", "member_limit", "not_applicant", "not_found"];
    const ids = reasons.map((_, i) => app(i + 1));
    queueVisible(ids);
    service.queueRpc("create_screening_invites", {
      data: reasons.map((reason, i) => ({ application_id: ids[i], ok: false, reason })),
      error: null,
    });

    const result = await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: ids, via: "agent" });
    expect(result.ok && result.skipped.map((s) => s.reason)).toEqual(reasons);
  });

  it("skips applications the session can't see without sending them", async () => {
    queueVisible([app(2)]);
    service.queueRpc("create_screening_invites", {
      data: [{ application_id: app(2), ok: true, id: ai(2) }],
      error: null,
    });

    const result = await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: [app(1), app(2)], via: "manual" });

    expect(result).toEqual({
      ok: true,
      invited: [{ id: ai(2), applicationId: app(2) }],
      skipped: [{ id: app(1), reason: "not_found" }],
    });
    expect(bulkCalls()[0]).toMatchObject({ p_application_ids: [app(2)] });
  });

  it("doesn't call the RPC when the session can see none of them", async () => {
    queueVisible([]);
    const result = await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: [app(1)], via: "manual" });
    expect(result).toEqual({ ok: true, invited: [], skipped: [{ id: app(1), reason: "not_found" }] });
    expect(bulkCalls()).toHaveLength(0);
  });

  it("dedupes the ids", async () => {
    queueVisible([app(1)]);
    service.queueRpc("create_screening_invites", {
      data: [{ application_id: app(1), ok: true, id: ai(1) }],
      error: null,
    });
    await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: [app(1), app(1)], via: "manual" });
    expect(bulkCalls()[0]).toMatchObject({ p_application_ids: [app(1)] });
  });

  it("marks every application failed when the RPC errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queueVisible([app(1), app(2)]);
    service.queueRpc("create_screening_invites", { data: null, error: { message: "down" } });

    expect(await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: [app(1), app(2)], via: "manual" })).toEqual({
      ok: true,
      invited: [],
      skipped: [
        { id: app(1), reason: "failed" },
        { id: app(2), reason: "failed" },
      ],
    });
  });

  it(`refuses more than ${MAX_BULK_INVITES} at once`, async () => {
    const ids = Array.from({ length: MAX_BULK_INVITES + 1 }, (_, i) => `e0000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: ids, via: "manual" })).toEqual({
      ok: false,
      error: `Invite at most ${MAX_BULK_INVITES} applicants at a time.`,
    });
    expect(session.calls).toHaveLength(0);
  });

  it("sends no email itself: the RPC queues it", async () => {
    queueVisible([app(1)]);
    service.queueRpc("create_screening_invites", {
      data: [{ application_id: app(1), ok: true, id: ai(1) }],
      error: null,
    });
    await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: [app(1)], via: "manual" });
    await flushAfter();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("sendInterviewInviteEmail (SI-REQ-013)", () => {
  const interview = { id: ai(1), deadline_at: "2026-10-24T12:00:00.000Z", config_snapshot: snapshot };

  it("emails the link and the competencies, never the rubric or the questions", async () => {
    await sendInterviewInviteEmail(interview, { email: "cand1@example.com", full_name: "Cand1 Last" });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.toEmail).toBe("cand1@example.com");
    expect(mail.subject).toBe("Acme invited you to an AI interview for Backend Engineer");
    expect(mail.senderName).toBe("Acme via GetHired");
    expect(mail.htmlContent).toContain(`/interview/screening/${ai(1)}`);
    expect(mail.textContent).toContain("Hi Cand1");
    expect(mail.textContent).toContain("System design");
    expect(mail.textContent).not.toContain("Secret");
  });

  it("throws when the send fails, so the worker retries", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("all providers down"));
    await expect(
      sendInterviewInviteEmail(interview, { email: "cand1@example.com", full_name: "Cand1 Last" }),
    ).rejects.toThrow("all providers down");
  });
});

describe("inviteCostPreview", () => {
  it("is the interview length times the number of invites", () => {
    expect(inviteCostPreview({ duration_minutes: 15 }, 4)).toEqual({ minutesPerInvite: 15, totalMinutes: 60 });
  });
});
