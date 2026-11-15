import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { sendEmail } from "@/utils/email";
import { FEEDBACK_BATCH, kitPath, sendInterviewFeedbackEmails } from "./feedback-emails";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ deploymentUrl: () => "https://gethired.test" }));

const VERA = "c7000000-0000-4000-8000-000000000001";
const NORA = "c8000000-0000-4000-8000-000000000001";
const I1 = "f1300000-0000-4000-8000-000000000001";
const STAMP = "2026-11-14T10:00:00.000Z";

const due = (user_id: string, kind: "request" | "reminder") => ({
  interview_id: I1,
  user_id,
  kind,
  interview_name: "Tech screen",
  job_title: "Backend Engineer",
  candidate_name: "Ada Lovelace",
});

function setup(emails: Record<string, string | null> = { [VERA]: "vera@acme.test", [NORA]: "nora@acme.test" }) {
  const db = createSupabaseMock();
  const getUserById = vi.fn(async (id: string) => ({ data: { user: emails[id] ? { email: emails[id] } : null }, error: null }));
  Object.assign((db.client as unknown as { auth: object }).auth, { admin: { getUserById } });
  return { db, getUserById };
}

beforeEach(() => vi.clearAllMocks());

describe("sendInterviewFeedbackEmails (IVT-070)", () => {
  it("claims each email before sending it, with a link to the kit", async () => {
    const { db } = setup();
    db.queueRpc("interview_feedback_due", { data: [due(VERA, "request"), due(NORA, "reminder")], error: null });
    db.queueRpc("claim_interview_feedback_email", { data: STAMP, error: null });
    db.queueRpc("claim_interview_feedback_email", { data: STAMP, error: null });

    expect(await sendInterviewFeedbackEmails(db.client)).toEqual({ due: 2, sent: 2, skipped: 0, failures: [] });
    expect(db.callsFor("interview_feedback_due")[0].chain[0].args[1]).toEqual({ p_limit: FEEDBACK_BATCH });
    expect(db.callsFor("claim_interview_feedback_email").map((c) => c.chain[0].args[1])).toEqual([
      { p_interview_id: I1, p_user_id: VERA, p_kind: "request" },
      { p_interview_id: I1, p_user_id: NORA, p_kind: "reminder" },
    ]);
    const [request, reminder] = vi.mocked(sendEmail).mock.calls.map((c) => c[0]);
    expect(request.toEmail).toBe("vera@acme.test");
    expect(request.subject).toBe("Your scorecard for Ada: Tech screen");
    expect(request.htmlContent).toContain(`https://gethired.test${kitPath(I1)}`);
    expect(reminder.toEmail).toBe("nora@acme.test");
    expect(reminder.subject).toBe("Reminder: your scorecard for Ada is still open");
  });

  it("sends nothing it couldn't claim (a repeated run, or submitted meanwhile)", async () => {
    const { db } = setup();
    db.queueRpc("interview_feedback_due", { data: [due(VERA, "request")], error: null });
    db.queueRpc("claim_interview_feedback_email", { data: null, error: null });
    expect(await sendInterviewFeedbackEmails(db.client)).toEqual({ due: 1, sent: 0, skipped: 1, failures: [] });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("releases the claim when the send fails, so the next run retries", async () => {
    const { db } = setup();
    db.queueRpc("interview_feedback_due", { data: [due(VERA, "request")], error: null });
    db.queueRpc("claim_interview_feedback_email", { data: STAMP, error: null });
    db.queueRpc("release_interview_feedback_email", { data: true, error: null });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("smtp down"));

    const result = await sendInterviewFeedbackEmails(db.client);
    expect(result).toMatchObject({ due: 1, sent: 0, failures: [`${I1}/${VERA}: smtp down`] });
    expect(db.callsFor("release_interview_feedback_email")[0].chain[0].args[1]).toEqual({
      p_interview_id: I1,
      p_user_id: VERA,
      p_kind: "request",
      p_claimed_at: STAMP,
    });
  });

  it("skips a member without an email address, and says 'the candidate' without a name", async () => {
    const { db } = setup({ [VERA]: null, [NORA]: "nora@acme.test" });
    db.queueRpc("interview_feedback_due", {
      data: [due(VERA, "request"), { ...due(NORA, "request"), candidate_name: null }],
      error: null,
    });
    db.queueRpc("claim_interview_feedback_email", { data: STAMP, error: null });
    db.queueRpc("claim_interview_feedback_email", { data: STAMP, error: null });
    expect(await sendInterviewFeedbackEmails(db.client)).toMatchObject({ sent: 1, skipped: 1 });
    expect(vi.mocked(sendEmail).mock.calls[0][0].subject).toBe("Your scorecard for the candidate: Tech screen");
  });

  it("throws when the due list can't be read", async () => {
    const { db } = setup();
    db.queueRpc("interview_feedback_due", { data: null, error: { message: "db down" } });
    await expect(sendInterviewFeedbackEmails(db.client)).rejects.toThrow("db down");
  });
});
