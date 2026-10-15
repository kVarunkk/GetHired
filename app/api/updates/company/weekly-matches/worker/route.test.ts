import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { explanationOf } from "@/test/utils/matching";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({
  INTERNAL_API_SECRET: "test-secret",
  deploymentUrl: () => "https://gethired.test",
}));
vi.mock("server-only", () => ({}));

const NOW = new Date("2026-10-19T03:35:00.000Z"); // a Monday, 09:05 IST
const WEEK_AGO = "2026-10-12T03:35:00.000Z";
const JOB_1 = { id: "b0000000-0000-4000-8000-000000000001", title: "Backend Engineer" };
const JOB_2 = { id: "b0000000-0000-4000-8000-000000000002", title: "Designer" };

let db: SupabaseMock;

const message = (msg_id: number, read_ct = 1) => ({ msg_id, read_ct, message: { companyId: COMPANY_A.id } });
const companyRow = (overrides: Record<string, unknown> = {}) => ({
  id: COMPANY_A.id,
  name: "Acme",
  email: "hr@acme.dev",
  notify_weekly_matches: true,
  ...overrides,
});
const match = (name: string, score: number, summary: string | null) => ({
  match_score: score,
  explanation: summary ? explanationOf({ summary }) : null,
  user_info: { full_name: name, email: "private@mail.test" },
});

const run = (secret: string | null = "test-secret") =>
  GET(
    buildRequest("/api/updates/company/weekly-matches/worker", {
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );
const archived = () =>
  db.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(sendEmail).mockResolvedValue(undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("GET /api/updates/company/weekly-matches/worker (PLT-073, PL-REQ-010)", () => {
  it("401s without the secret", async () => {
    expect((await run(null)).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("sends each active job's new match count and top 3, first names and summaries only", async () => {
    db.queueRpc("read", { data: [message(7)], error: null }, "pgmq_public");
    db.queue("company_info", { data: companyRow(), error: null });
    db.queue("job_postings", { data: [JOB_1, JOB_2], error: null });
    // JOB_1: 5 new matches. JOB_2: none, so it's left out.
    db.queue("job_relevant_profiles", { data: null, error: null, count: 5 });
    db.queue("job_relevant_profiles", {
      data: [
        match("Priya Sharma", 91, "Built payments infra at scale."),
        match("Arjun Rao", 84, null),
        match("Meera Iyer", 80, "Strong Go and Postgres."),
      ],
      error: null,
    });
    db.queue("job_relevant_profiles", { data: null, error: null, count: 0 });

    expect(await (await run()).json()).toEqual({ sent: 1, failed: 0 });

    const email = vi.mocked(sendEmail).mock.calls[0][0];
    expect(email.toEmail).toBe("hr@acme.dev");
    expect(email.subject).toBe("5 new matched candidates this week");
    for (const out of [email.htmlContent, email.textContent]) {
      expect(out).toContain("Backend Engineer");
      expect(out).not.toContain("Designer");
      expect(out).toContain("Priya · match 91: Built payments infra at scale.");
      expect(out).toContain("Arjun · match 84");
      expect(out).not.toContain("Sharma");
      expect(out).not.toContain("private@mail.test");
    }
    expect(email.htmlContent).toContain("https://gethired.test/company/settings#notifications");

    const [jobs] = db.callsFor("job_postings");
    expect(jobs.chain).toContainEqual({ method: "eq", args: ["status", "active"] });
    const [count, top] = db.callsFor("job_relevant_profiles");
    expect(count.chain).toContainEqual({ method: "gte", args: ["created_at", WEEK_AGO] });
    expect(top.chain).toContainEqual({ method: "limit", args: [3] });
    expect(archived()).toEqual([7]);
  });

  it("sends nothing to a company with no new matches", async () => {
    db.queueRpc("read", { data: [message(7)], error: null }, "pgmq_public");
    db.queue("company_info", { data: companyRow(), error: null });
    db.queue("job_postings", { data: [JOB_1], error: null });
    db.queue("job_relevant_profiles", { data: null, error: null, count: 0 });

    await run();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("sends nothing to a company that opted out since it was queued", async () => {
    db.queueRpc("read", { data: [message(7)], error: null }, "pgmq_public");
    db.queue("company_info", { data: companyRow({ notify_weekly_matches: false }), error: null });

    await run();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.callsFor("job_postings")).toHaveLength(0);
    expect(archived()).toEqual([7]);
  });

  it("archives and reports an email that fails on its third read", async () => {
    db.queueRpc("read", { data: [message(7, 3)], error: null }, "pgmq_public");
    db.queue("company_info", { data: companyRow(), error: null });
    db.queue("job_postings", { data: [JOB_1], error: null });
    db.queue("job_relevant_profiles", { data: null, error: null, count: 1 });
    db.queue("job_relevant_profiles", { data: [match("Priya Sharma", 91, null)], error: null });
    vi.mocked(sendEmail).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await (await run()).json()).toEqual({ sent: 0, failed: 1 });
    expect(archived()).toEqual([7]);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("Gave up on 1 email"));
  });
});
