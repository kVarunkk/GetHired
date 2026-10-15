import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
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

const NOW = new Date("2026-10-15T12:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const JOB = { id: "b0000000-0000-4000-8000-000000000001", title: "Backend Engineer", company_id: COMPANY_A.id };
const appId = (n: number) => `e0000000-0000-4000-8000-00000000000${n}`;

let db: SupabaseMock;

const message = (msg_id: number, n: number, read_ct = 1) => ({
  msg_id,
  read_ct,
  message: { type: "new_applicant", applicationId: appId(n), jobPostId: JOB.id },
});
const jobRow = (overrides: Record<string, unknown> = {}) => ({
  id: JOB.id,
  company_id: COMPANY_A.id,
  last_applicant_notified_at: null,
  company_info: { name: "Acme", email: "hr@acme.dev", notify_new_applicants: "instant" },
  ...overrides,
});
const appRow = (n: number, createdAt: string) => ({
  id: appId(n),
  created_at: createdAt,
  user_info: { full_name: `Candidate ${n}` },
  application_screenings: null,
  job_postings: JOB,
});

const run = () =>
  GET(
    buildRequest("/api/worker/company-notifications", { headers: { "X-Internal-Secret": "test-secret" } }),
  );

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const throttleUpdates = () =>
  db
    .callsFor("job_postings")
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
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("GET /api/worker/company-notifications (PLT-071, PL-REQ-009)", () => {
  it("401s without the secret", async () => {
    const res = await GET(buildRequest("/api/worker/company-notifications"));

    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("sends one email for a new application and starts the job's throttle", async () => {
    db.queueRpc("read", { data: [message(7, 1)], error: null }, "pgmq_public");
    db.queue("job_postings", { data: jobRow(), error: null });
    db.queue("applications", { data: [appRow(1, minutesAgo(1))], error: null });

    expect(await (await run()).json()).toEqual({ sent: 1, failed: 0 });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const email = vi.mocked(sendEmail).mock.calls[0][0];
    expect(email.toEmail).toBe("hr@acme.dev");
    expect(email.subject).toBe("New applicant for Backend Engineer");
    expect(email.textContent).toContain("Candidate 1");
    expect(throttleUpdates()).toEqual([{ last_applicant_notified_at: NOW.toISOString() }]);
    expect(archived()).toEqual([7]);
  });

  it("holds a second application within 15 minutes of the last email", async () => {
    db.queueRpc("read", { data: [message(8, 2)], error: null }, "pgmq_public");
    db.queue("job_postings", { data: jobRow({ last_applicant_notified_at: minutesAgo(5) }), error: null });

    expect(await (await run()).json()).toEqual({ sent: 0, failed: 0 });

    expect(sendEmail).not.toHaveBeenCalled();
    // Left in the queue: it comes back after the visibility timeout.
    expect(archived()).toEqual([]);
    expect(db.callsFor("applications")).toHaveLength(0);
  });

  it("batches the held applications into the next send once the window has passed", async () => {
    db.queueRpc("read", { data: [message(8, 2, 10), message(9, 3)], error: null }, "pgmq_public");
    const last = minutesAgo(16);
    db.queue("job_postings", { data: jobRow({ last_applicant_notified_at: last }), error: null });
    db.queue("applications", { data: [appRow(2, minutesAgo(11)), appRow(3, minutesAgo(2))], error: null });

    await run();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const email = vi.mocked(sendEmail).mock.calls[0][0];
    expect(email.subject).toBe("New applicants for Backend Engineer");
    expect(email.textContent).toContain("Candidate 2");
    expect(email.textContent).toContain("Candidate 3");
    const [load] = db.callsFor("applications");
    expect(load.chain).toContainEqual({ method: "gt", args: ["created_at", last] });
    expect(load.chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB.id] });
    expect(archived()).toEqual([8, 9]);
  });

  it("archives without an email when the applications were already covered", async () => {
    db.queueRpc("read", { data: [message(8, 2)], error: null }, "pgmq_public");
    db.queue("job_postings", { data: jobRow({ last_applicant_notified_at: minutesAgo(20) }), error: null });
    db.queue("applications", { data: [], error: null });

    await run();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(archived()).toEqual([8]);
  });

  it("sends nothing to a company switched to off since the message was queued", async () => {
    db.queueRpc("read", { data: [message(7, 1)], error: null }, "pgmq_public");
    db.queue("job_postings", {
      data: jobRow({ company_info: { name: "Acme", email: "hr@acme.dev", notify_new_applicants: "off" } }),
      error: null,
    });

    await run();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("keeps the messages and the throttle when the send fails", async () => {
    db.queueRpc("read", { data: [message(7, 1)], error: null }, "pgmq_public");
    db.queue("job_postings", { data: jobRow(), error: null });
    db.queue("applications", { data: [appRow(1, minutesAgo(1))], error: null });
    vi.mocked(sendEmail).mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await (await run()).json()).toEqual({ sent: 0, failed: 0 });
    expect(throttleUpdates()).toEqual([]);
    expect(archived()).toEqual([]);
  });
});
