import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({
  INTERNAL_API_SECRET: "test-secret",
  deploymentUrl: () => "https://gethired.test",
}));
vi.mock("server-only", () => ({}));

const QUEUE = "applicant_digest_queue";
const JOB_1 = { id: "b0000000-0000-4000-8000-000000000001", title: "Backend Engineer", company_id: COMPANY_A.id };
const JOB_2 = { id: "b0000000-0000-4000-8000-000000000002", title: "Designer", company_id: COMPANY_A.id };
const WATERMARK = "2026-10-14T03:30:00.000Z";

let db: SupabaseMock;

const message = (msg_id: number, read_ct = 1) => ({ msg_id, read_ct, message: { companyId: COMPANY_A.id } });
const companyRow = (overrides: Record<string, unknown> = {}) => ({
  id: COMPANY_A.id,
  name: "Acme",
  email: "hr@acme.dev",
  notify_new_applicants: "daily",
  last_applicant_digest_at: WATERMARK,
  ...overrides,
});
const appRow = (n: number, job: typeof JOB_1, createdAt: string, fit: number | null) => ({
  id: `e0000000-0000-4000-8000-00000000000${n}`,
  created_at: createdAt,
  user_info: { full_name: `Candidate ${n}`, email: `c${n}@mail.test` },
  application_screenings: fit === null ? null : { status: "completed", fit_score: fit },
  job_postings: job,
});

function queued(...messages: ReturnType<typeof message>[]) {
  db.queueRpc("read", { data: messages, error: null }, "pgmq_public");
}

const run = (secret: string | null = "test-secret") =>
  GET(
    buildRequest("/api/updates/company/applicant-digest/worker", {
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const watermarkUpdates = () =>
  db
    .callsFor("company_info")
    .filter((c) => has(c, "update"))
    .map((c) => c.chain.find((m) => m.method === "update")!.args[0]);
const archived = () =>
  db.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(sendEmail).mockResolvedValue(undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T03:35:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("GET /api/updates/company/applicant-digest/worker (PLT-071, PL-TEST-007)", () => {
  it.each([
    ["a missing", null],
    ["a wrong", "nope"],
  ])("401s with %s secret", async (_label, secret) => {
    expect((await run(secret)).status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("sends one email per company, grouped by job, with fit scores, links and no contact details", async () => {
    queued(message(7));
    db.queue("company_info", { data: companyRow(), error: null });
    db.queue("applications", {
      data: [
        appRow(1, JOB_1, "2026-10-14T06:00:00.000Z", 82),
        appRow(2, JOB_2, "2026-10-14T07:00:00.000Z", null),
        appRow(3, JOB_1, "2026-10-14T09:00:00.000Z", 64),
      ],
      error: null,
    });

    expect(await (await run()).json()).toEqual({ sent: 1, failed: 0 });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const email = vi.mocked(sendEmail).mock.calls[0][0];
    expect(email.toEmail).toBe("hr@acme.dev");
    expect(email.subject).toBe("3 new applicants yesterday");
    for (const out of [email.htmlContent, email.textContent]) {
      expect(out).toContain("Backend Engineer");
      expect(out).toContain("Designer");
      expect(out).toContain("Candidate 1 · fit score 82");
      expect(out).toContain("Candidate 2 · fit score pending");
      expect(out).not.toContain("@mail.test");
    }
    expect(email.htmlContent).toContain(`https://gethired.test/company/job-posts/${JOB_1.id}/applications`);

    // Applications since the watermark, for this company only.
    const [load] = db.callsFor("applications");
    expect(load.chain).toContainEqual({ method: "eq", args: ["job_postings.company_id", COMPANY_A.id] });
    expect(load.chain).toContainEqual({ method: "gt", args: ["created_at", WATERMARK] });
    // The watermark moves to the newest application, after the send.
    expect(watermarkUpdates()).toEqual([{ last_applicant_digest_at: "2026-10-14T09:00:00.000Z" }]);
    expect(archived()).toEqual([7]);
  });

  it("looks back a day for a company's first digest", async () => {
    queued(message(7));
    db.queue("company_info", { data: companyRow({ last_applicant_digest_at: null }), error: null });
    db.queue("applications", { data: [], error: null });

    await run();

    const [load] = db.callsFor("applications");
    expect(load.chain).toContainEqual({ method: "gt", args: ["created_at", "2026-10-14T03:35:00.000Z"] });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("leaves the watermark and the message for a retry when the send fails", async () => {
    queued(message(7, 1));
    db.queue("company_info", { data: companyRow(), error: null });
    db.queue("applications", { data: [appRow(1, JOB_1, "2026-10-14T06:00:00.000Z", 82)], error: null });
    vi.mocked(sendEmail).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await (await run()).json()).toEqual({ sent: 0, failed: 0 });
    expect(watermarkUpdates()).toEqual([]);
    expect(archived()).toEqual([]);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("archives and reports a digest that fails on its third read", async () => {
    queued(message(7, 3));
    db.queue("company_info", { data: companyRow(), error: null });
    db.queue("applications", { data: [appRow(1, JOB_1, "2026-10-14T06:00:00.000Z", 82)], error: null });
    vi.mocked(sendEmail).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await (await run()).json()).toEqual({ sent: 0, failed: 1 });
    expect(archived()).toEqual([7]);
    expect(watermarkUpdates()).toEqual([]);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("Gave up on 1 digest"));
  });

  it("archives without sending when the company left daily or has no email", async () => {
    queued(message(7), message(8));
    db.queue("company_info", { data: companyRow({ notify_new_applicants: "off" }), error: null });
    db.queue("company_info", { data: companyRow({ email: null }), error: null });

    await run();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(archived()).toEqual([7, 8]);
  });

  it("reads the digest queue", async () => {
    queued();

    await run();

    expect(db.callsFor("read")[0].chain[0].args[1]).toMatchObject({ queue_name: QUEUE });
  });
});
