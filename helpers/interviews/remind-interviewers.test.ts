import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { sendEmail } from "@/utils/email";
import { kitPath } from "./feedback-emails";
import { previewReminders, remindInterviewers } from "./remind-interviewers";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ deploymentUrl: () => "https://gethired.test" }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const I1 = "f1800000-0000-4000-8000-000000000001";
const APP = "e0000000-0000-4000-8000-000000000002";
const VERA = "c7000000-0000-4000-8000-000000000001";
const NORA = "c8000000-0000-4000-8000-000000000001";
const PAT = "c4000000-0000-4000-8000-000000000001";
const STAMP = "2026-11-14T10:00:00.000Z";

const result = (members: { user_id: string; name: string; state: string }[], claimed_at: string | null = null) => ({
  ok: true,
  application_id: APP,
  interview_name: "Tech screen",
  job_title: "Backend Engineer",
  candidate_name: "Ada Lovelace",
  members,
  claimed_at,
});

function setup(emails: Record<string, string | null> = { [VERA]: "vera@acme.test", [PAT]: "pat@acme.test" }) {
  const supabase = createSupabaseMock();
  const admin = createSupabaseMock();
  const getUserById = vi.fn(async (id: string) => ({ data: { user: emails[id] ? { email: emails[id] } : null }, error: null }));
  Object.assign((admin.client as unknown as { auth: object }).auth, { admin: { getUserById } });
  return { supabase, admin, deps: { supabase: supabase.client, admin: admin.client, senderName: "Rita" } };
}

beforeEach(() => vi.clearAllMocks());

describe("remindInterviewers (IVT-084)", () => {
  it("claims, then emails each member who still owes a scorecard, with a link to their kit", async () => {
    const { supabase, deps } = setup();
    supabase.queueRpc("interviewer_reminders", {
      data: result(
        [
          { user_id: VERA, name: "Vera", state: "claimed" },
          { user_id: NORA, name: "Nora", state: "submitted" },
          { user_id: PAT, name: "Pat", state: "claimed" },
        ],
        STAMP,
      ),
      error: null,
    });

    const out = await remindInterviewers(deps, I1);
    expect(out).toEqual({
      ok: true,
      applicationId: APP,
      reminded: [
        { userId: VERA, name: "Vera" },
        { userId: PAT, name: "Pat" },
      ],
      skipped: [{ userId: NORA, name: "Nora", reason: "submitted" }],
    });
    expect(supabase.callsFor("interviewer_reminders")[0].chain[0].args[1]).toEqual({ p_interview_id: I1, p_claim: true });
    const emails = vi.mocked(sendEmail).mock.calls.map((c) => c[0]);
    expect(emails.map((e) => e.toEmail)).toEqual(["vera@acme.test", "pat@acme.test"]);
    expect(emails[0].subject).toBe("Reminder: your scorecard for Ada is still open");
    expect(emails[0].htmlContent).toContain(`https://gethired.test${kitPath(I1)}`);
    expect(emails[0].htmlContent).toContain("Rita asked for your feedback");
    expect(emails[0].htmlContent).not.toContain("last reminder");
  });

  it("emails nobody reminded in the last 24 hours", async () => {
    const { supabase, deps } = setup();
    supabase.queueRpc("interviewer_reminders", {
      data: result([{ user_id: VERA, name: "Vera", state: "recent" }], STAMP),
      error: null,
    });
    const out = await remindInterviewers(deps, I1);
    expect(out).toMatchObject({ ok: true, reminded: [], skipped: [{ userId: VERA, reason: "recent" }] });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("releases the claim when a send fails, so the member can be reminded again", async () => {
    const { supabase, admin, deps } = setup();
    supabase.queueRpc("interviewer_reminders", {
      data: result([{ user_id: VERA, name: "Vera", state: "claimed" }], STAMP),
      error: null,
    });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("resend down"));

    const out = await remindInterviewers(deps, I1);
    expect(out).toMatchObject({ ok: true, reminded: [], skipped: [{ userId: VERA, reason: "failed" }] });
    expect(admin.callsFor("release_interviewer_reminder")[0].chain[0].args[1]).toEqual({
      p_interview_id: I1,
      p_user_id: VERA,
      p_claimed_at: STAMP,
    });
  });

  it("turns the RPC's refusals into copy that names the permission", async () => {
    const { supabase, deps } = setup();
    supabase.queueRpc("interviewer_reminders", { data: { ok: false, reason: "forbidden" }, error: null });
    expect(await remindInterviewers(deps, I1)).toEqual({
      ok: false,
      reason: "forbidden",
      error: "Your role can't schedule interviews for this job.",
    });
    supabase.queueRpc("interviewer_reminders", { data: { ok: false, reason: "not_started" }, error: null });
    expect(await remindInterviewers(deps, I1)).toMatchObject({ ok: false, reason: "not_started" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses an id that isn't a uuid without calling the database", async () => {
    const { supabase, deps } = setup();
    expect(await remindInterviewers(deps, "nope")).toMatchObject({ ok: false, reason: "not_found" });
    expect(supabase.calls).toHaveLength(0);
  });
});

describe("previewReminders (IVT-084)", () => {
  it("reads who would be emailed without claiming", async () => {
    const { supabase } = setup();
    supabase.queueRpc("interviewer_reminders", {
      data: result([
        { user_id: VERA, name: "Vera", state: "due" },
        { user_id: NORA, name: "Nora", state: "submitted" },
        { user_id: PAT, name: "Pat", state: "recent" },
      ]),
      error: null,
    });
    expect(await previewReminders(supabase.client, I1)).toEqual({
      ok: true,
      applicationId: APP,
      interviewName: "Tech screen",
      jobTitle: "Backend Engineer",
      candidateName: "Ada Lovelace",
      due: [{ userId: VERA, name: "Vera" }],
      skipped: [
        { userId: NORA, name: "Nora", reason: "submitted" },
        { userId: PAT, name: "Pat", reason: "recent" },
      ],
    });
    expect(supabase.callsFor("interviewer_reminders")[0].chain[0].args[1]).toEqual({ p_interview_id: I1, p_claim: false });
  });
});
