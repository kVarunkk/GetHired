import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { flushAfter } from "@/test/utils/after";
import { ADMIN_A } from "@/test/utils/team";
import { MAX_BULK_INVITES, inviteApplicants, inviteCostPreview } from "./invite";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));

const JOB = "b0000000-0000-4000-8000-0000000000a1";
const app = (n: number) => `e0000000-0000-4000-8000-00000000000${n}`;
const ai = (n: number) => `fa000000-0000-4000-8000-00000000000${n}`;
const applicant = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;

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

/** The session's view of the applications (RLS), each on JOB unless given. */
function queueVisible(ids: string[], jobPostId = JOB) {
  session.queue("applications", { data: ids.map((id) => ({ id, job_post_id: jobPostId })), error: null });
}

function queueEmailContext(rows: { n: number }[]) {
  service.queue("application_interviews", {
    data: rows.map(({ n }) => ({
      id: ai(n),
      applicant_user_id: applicant(n),
      deadline_at: "2026-10-24T12:00:00.000Z",
      config_snapshot: snapshot,
    })),
    error: null,
  });
  service.queue("user_info", {
    data: rows.map(({ n }) => ({ user_id: applicant(n), email: `cand${n}@example.com`, full_name: `Cand${n} Last` })),
    error: null,
  });
}

describe("inviteApplicants (SI-REQ-010/012/013, SI-TEST-002)", () => {
  it("invites each application through create_screening_invite as the session user", async () => {
    queueVisible([app(1), app(2)]);
    service.queueRpc("create_screening_invite", { data: { ok: true, id: ai(1) }, error: null });
    service.queueRpc("create_screening_invite", { data: { ok: false, reason: "exists" }, error: null });

    const result = await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: [app(1), app(2)], via: "manual" });

    expect(result).toEqual({
      ok: true,
      invited: [{ id: ai(1), applicationId: app(1) }],
      skipped: [{ id: app(2), reason: "exists" }],
    });
    expect(service.callsFor("create_screening_invite").map((c) => c.chain[0].args[1])).toEqual([
      { p_application_id: app(1), p_via: "manual", p_invited_by: ADMIN_A.user.id },
      { p_application_id: app(2), p_via: "manual", p_invited_by: ADMIN_A.user.id },
    ]);
  });

  it("passes every refusal reason through", async () => {
    const reasons = ["disabled", "job_inactive", "insufficient_credits", "member_limit", "not_applicant"];
    const ids = reasons.map((_, i) => app(i + 1));
    queueVisible(ids);
    for (const reason of reasons) {
      service.queueRpc("create_screening_invite", { data: { ok: false, reason }, error: null });
    }

    const result = await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: ids, via: "agent" });
    expect(result.ok && result.skipped.map((s) => s.reason)).toEqual(reasons);
  });

  it("skips applications the session can't see or that belong to another job", async () => {
    session.queue("applications", { data: [{ id: app(1), job_post_id: "other-job" }], error: null });

    const result = await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: [app(1), app(2)], via: "manual" });

    expect(result).toEqual({
      ok: true,
      invited: [],
      skipped: [
        { id: app(1), reason: "not_found" },
        { id: app(2), reason: "not_found" },
      ],
    });
    expect(service.callsFor("create_screening_invite")).toHaveLength(0);
  });

  it(`refuses more than ${MAX_BULK_INVITES} at once`, async () => {
    const ids = Array.from({ length: MAX_BULK_INVITES + 1 }, (_, i) => `e0000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: ids, via: "manual" })).toEqual({
      ok: false,
      error: `Invite at most ${MAX_BULK_INVITES} applicants at a time.`,
    });
    expect(session.calls).toHaveLength(0);
  });

  it("emails only the invites it created, after the response", async () => {
    queueVisible([app(1), app(2)]);
    service.queueRpc("create_screening_invite", { data: { ok: true, id: ai(1) }, error: null });
    service.queueRpc("create_screening_invite", { data: { ok: false, reason: "exists" }, error: null });
    queueEmailContext([{ n: 1 }]);

    await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: [app(1), app(2)], via: "manual" });
    expect(sendEmail).not.toHaveBeenCalled();

    await flushAfter();
    expect(service.callsFor("application_interviews")[0].chain).toContainEqual({ method: "in", args: ["id", [ai(1)]] });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendEmail).mock.calls[0][0];
    expect(mail.toEmail).toBe("cand1@example.com");
    expect(mail.subject).toBe("Acme invited you to an AI interview for Backend Engineer");
    expect(mail.htmlContent).toContain(`/interview/screening/${ai(1)}`);
    expect(mail.textContent).toContain("Hi Cand1");
    expect(mail.textContent).toContain("System design");
    // Never the rubric or the must-ask questions.
    expect(mail.textContent).not.toContain("Secret");
  });

  it("sends nothing when nothing was created", async () => {
    queueVisible([app(1)]);
    service.queueRpc("create_screening_invite", { data: { ok: false, reason: "disabled" }, error: null });
    await inviteApplicants(deps(), { jobPostId: JOB, applicationIds: [app(1)], via: "manual" });
    await flushAfter();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("inviteCostPreview", () => {
  it("is the interview length times the number of invites", () => {
    expect(inviteCostPreview({ duration_minutes: 15 }, 4)).toEqual({ minutesPerInvite: 15, totalMinutes: 60 });
  });
});
