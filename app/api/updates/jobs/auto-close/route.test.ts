import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { enqueueFeedRebuild } from "@/helpers/distribution/feed-queue";
import { announceJobStateChange } from "@/helpers/jobs/set-job-post-state";
import { buildRequest } from "@/test/utils/request";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { CLOSING_SOON_DAYS } from "@/helpers/company-dashboard/summary";
import { GET, POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret", deploymentUrl: () => "https://app.test" }));
vi.mock("@/helpers/distribution/feed-queue", () => ({ enqueueFeedRebuild: vi.fn() }));
vi.mock("@/helpers/jobs/set-job-post-state", () => ({ announceJobStateChange: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const JOB_1 = "b0000000-0000-4000-8000-000000000001";
const JOB_2 = "b0000000-0000-4000-8000-000000000002";
const OWNER = "c1000000-0000-4000-8000-000000000001";
const ASSIGNED = "c7000000-0000-4000-8000-000000000001";
const OTHER = "c7000000-0000-4000-8000-000000000002";

const EMAILS: Record<string, string> = {
  [OWNER]: "owner@acme.dev",
  [ASSIGNED]: "recruiter@acme.dev",
  [OTHER]: "other@acme.dev",
};

let db: SupabaseMock;
const getUserById = vi.fn();

const run = (handler: typeof POST = POST, secret: string | null = "test-secret") =>
  handler(
    buildRequest("/api/updates/jobs/auto-close", {
      method: handler === GET ? "GET" : "POST",
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

function queueRun({
  closed = [] as object[],
  soon = [] as object[],
  closeError = null as { message: string } | null,
} = {}) {
  db.queueRpc("close_due_job_posts", { data: closeError ? null : closed, error: closeError });
  db.queueRpc("claim_closing_soon_job_posts", { data: soon, error: null });
  for (let i = 0; i < 10; i++) {
    db.queue("company_members", {
      data: [
        { user_id: OWNER, is_owner: true },
        { user_id: ASSIGNED, is_owner: false },
        { user_id: OTHER, is_owner: false },
      ],
      error: null,
    });
    db.queue("company_job_assignments", { data: [{ user_id: ASSIGNED }], error: null });
  }
}

const sentTo = () => vi.mocked(sendEmail).mock.calls.map(([args]) => [args.toEmail, args.subject]);

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  (db.client.auth as unknown as { admin: unknown }).admin = { getUserById };
  getUserById.mockImplementation(async (id: string) => ({ data: { user: { email: EMAILS[id] } }, error: null }));
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(sendEmail).mockResolvedValue(undefined);
});

describe("auto-close route: auth (JLT-042)", () => {
  it.each([null, "wrong"])("refuses secret %s without touching the database", async (secret) => {
    const res = await run(POST, secret);
    expect(res.status).toBe(401);
    expect(db.callsFor("close_due_job_posts")).toHaveLength(0);
  });

  it("answers GET too, for pg_cron's http_get", async () => {
    queueRun();
    expect((await run(GET)).status).toBe(200);
  });
});

describe("auto-close route: closing due jobs (JLT-042, JL-REQ-015)", () => {
  const CLOSED = [
    { job_post_id: JOB_1, job_id: "d0000000-0000-4000-8000-000000000001", company_id: COMPANY, title: "Backend Engineer", closes_at: "2026-11-23" },
    { job_post_id: JOB_2, job_id: null, company_id: COMPANY, title: "Designer", closes_at: "2026-11-22" },
  ];

  it("runs the move's side effects for each closed job and queues one feed rebuild", async () => {
    queueRun({ closed: CLOSED });

    const res = await run();

    expect(await res.json()).toEqual({ closed: 2, reminded: 0 });
    expect(announceJobStateChange).toHaveBeenCalledTimes(2);
    expect(announceJobStateChange).toHaveBeenCalledWith(
      { companyId: COMPANY, postId: JOB_1, jobId: CLOSED[0].job_id, from: "open", to: "closed" },
      { rebuildFeed: false },
    );
    expect(enqueueFeedRebuild).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no job is due", async () => {
    queueRun();

    expect(await (await run()).json()).toEqual({ closed: 0, reminded: 0 });
    expect(announceJobStateChange).not.toHaveBeenCalled();
    expect(enqueueFeedRebuild).not.toHaveBeenCalled();
    await flushAfter();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails each job's owners and hiring team after the response, not other members", async () => {
    queueRun({ closed: CLOSED.slice(0, 1) });

    await run();
    expect(sendEmail).not.toHaveBeenCalled();
    await flushAfter();

    expect(sentTo().sort()).toEqual([
      ["owner@acme.dev", "Backend Engineer closed on its closing date"],
      ["recruiter@acme.dev", "Backend Engineer closed on its closing date"],
    ]);
    const { htmlContent, textContent } = vi.mocked(sendEmail).mock.calls[0][0];
    expect(textContent).toContain("November 23, 2026");
    expect(htmlContent).toContain(`https://app.test/company/job-posts/${JOB_1}`);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("reports a failed email without failing the run", async () => {
    queueRun({ closed: CLOSED.slice(0, 1) });
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("resend down"));

    expect((await run()).status).toBe(200);
    await flushAfter();

    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining(`closed ${JOB_1}`));
  });

  it("reports a failed close and answers 500", async () => {
    queueRun({ closeError: { message: "boom" } });

    expect((await run()).status).toBe(500);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(announceJobStateChange).not.toHaveBeenCalled();
  });
});

describe("auto-close route: closing soon reminder (JLT-045, JL-REQ-017)", () => {
  it(`claims the jobs closing within ${CLOSING_SOON_DAYS} days and reminds their teams`, async () => {
    queueRun({ soon: [{ job_post_id: JOB_2, company_id: COMPANY, title: "Designer", closes_at: "2026-11-27" }] });

    expect(await (await run()).json()).toEqual({ closed: 0, reminded: 1 });
    expect(db.callsFor("claim_closing_soon_job_posts")[0].chain[0].args[1]).toEqual({ p_days: CLOSING_SOON_DAYS });
    await flushAfter();

    expect(sentTo().sort()).toEqual([
      ["owner@acme.dev", "Designer closes on November 27, 2026"],
      ["recruiter@acme.dev", "Designer closes on November 27, 2026"],
    ]);
    expect(vi.mocked(sendEmail).mock.calls[0][0].htmlContent).toContain(`/company/job-posts/${JOB_2}/edit`);
  });
});
