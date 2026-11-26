import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ALERT_ID, ALERT_NOW, ALERT_USER_ID } from "@/test/utils/job-alerts";

vi.mock("@/helpers/jobs/search-jobs", () => ({ searchJobs: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/utils/formatters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/formatters")>()),
  INTERNAL_API_SECRET: "test-secret",
}));

import { searchJobs } from "@/helpers/jobs/search-jobs";
import { runJobAlert, type RunnableAlert } from "./run-alert";

let db: SupabaseMock;
const send = vi.fn();

const ALERT: RunnableAlert = {
  id: ALERT_ID,
  user_id: ALERT_USER_ID,
  name: "Frontend jobs in Pune",
  url: "/jobs?jobTitleKeywords=frontend&location=pune",
  filters: { jobTitleKeywords: ["frontend", "react"], location: ["pune"], minSalary: 100, salaryCurrency: "INR" },
  frequency: "weekly",
  created_at: "2026-11-01T00:00:00.000Z",
  last_checked_at: "2026-11-16T03:30:00.000Z",
  email: "ada@example.com",
  fullName: "Ada",
};

const job = (id: string) => ({
  id,
  job_name: `Job ${id}`,
  company_name: "Acme",
  locations: ["Pune"],
  salary_range: "₹10L",
  created_at: "2026-11-20T00:00:00.000Z",
});

const updates = () => db.callsFor("bookmarks").map((c) => c.chain);

beforeEach(() => {
  db = createSupabaseMock();
  db.queue("applications", { data: [{ all_jobs_id: "applied-1" }, { all_jobs_id: "applied-1" }], error: null });
  send.mockResolvedValue(undefined);
});

describe("runJobAlert (JAT-031, JA-TST-004)", () => {
  it("searches the alert's filters since the window start, newest first, without applied jobs", async () => {
    vi.mocked(searchJobs).mockResolvedValue({ ok: true, data: [], totalCount: 0, nextCursor: null });
    await runJobAlert(ALERT, { now: ALERT_NOW, supabase: db.client, send });

    expect(db.callsFor("applications")[0].chain).toContainEqual({
      method: "eq",
      args: ["applicant_user_id", ALERT_USER_ID],
    });
    expect(searchJobs).toHaveBeenCalledWith(db.client, null, {
      jobTitleKeywords: "frontend|react",
      location: "pune",
      jobType: null,
      platform: null,
      companyName: null,
      minSalary: "100",
      salaryCurrency: "INR",
      minExperience: null,
      maxExperience: null,
      sortBy: "created_at",
      sortOrder: "desc",
      limit: 10,
      createdSince: new Date(ALERT.last_checked_at!),
      excludeJobIds: ["applied-1"],
    });
  });

  it("sends nothing on zero jobs and moves last_checked_at", async () => {
    vi.mocked(searchJobs).mockResolvedValue({ ok: true, data: [], totalCount: 0, nextCursor: null });
    expect(await runJobAlert(ALERT, { now: ALERT_NOW, supabase: db.client, send })).toEqual({
      ok: true,
      sent: false,
      jobs: 0,
      total: 0,
    });
    expect(send).not.toHaveBeenCalled();
    expect(updates()[0]).toEqual([
      { method: "update", args: [{ last_checked_at: ALERT_NOW.toISOString() }] },
      { method: "eq", args: ["id", ALERT_ID] },
      { method: "eq", args: ["user_id", ALERT_USER_ID] },
    ]);
  });

  it("emails the jobs with the unsubscribe headers, then records the send", async () => {
    vi.mocked(searchJobs).mockResolvedValue({
      ok: true,
      data: [job("j1"), job("j2")] as never,
      totalCount: 14,
      nextCursor: null,
    });
    expect(await runJobAlert(ALERT, { now: ALERT_NOW, supabase: db.client, send })).toEqual({
      ok: true,
      sent: true,
      jobs: 2,
      total: 14,
    });

    const email = send.mock.calls[0][0];
    expect(email.toEmail).toBe("ada@example.com");
    expect(email.subject).toBe("14 new Frontend jobs in Pune");
    expect(email.headers["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:3000\/api\/job-alerts\/pause\/[\w-]+\.[\w-]+>$/);
    expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // "See all" is the alert's own url.
    expect(email.htmlContent).toContain(
      `href="http://localhost:3000/jobs?jobTitleKeywords=frontend&amp;location=pune&amp;ref=job_alert&amp;aid=${ALERT_ID}"`,
    );
    expect(email.htmlContent).toContain(`/jobs/j1?ref=job_alert&amp;aid=${ALERT_ID}`);
    expect(email.htmlContent).not.toMatch(/href="[^"]*[?&]src=/);

    const [patch] = updates()[0][0].args as [Record<string, string>];
    expect(patch.last_checked_at).toBe(ALERT_NOW.toISOString());
    expect(patch.last_sent_at).toEqual(expect.any(String));
  });

  it("leaves last_checked_at alone when the send fails, so the window is retried", async () => {
    vi.mocked(searchJobs).mockResolvedValue({ ok: true, data: [job("j1")] as never, totalCount: 1, nextCursor: null });
    send.mockRejectedValue(new Error("all providers failed"));
    expect(await runJobAlert(ALERT, { now: ALERT_NOW, supabase: db.client, send })).toEqual({
      ok: false,
      error: "send: all providers failed",
    });
    expect(db.callsFor("bookmarks")).toHaveLength(0);
  });

  it("caps a long-paused alert's window at 14 days", async () => {
    vi.mocked(searchJobs).mockResolvedValue({ ok: true, data: [], totalCount: 0, nextCursor: null });
    await runJobAlert(
      { ...ALERT, created_at: "2026-01-01T00:00:00Z", last_checked_at: "2026-02-01T00:00:00Z" },
      { now: ALERT_NOW, supabase: db.client, send },
    );
    expect(vi.mocked(searchJobs).mock.calls[0][2].createdSince).toEqual(
      new Date(ALERT_NOW.getTime() - 14 * 24 * 3600_000),
    );
  });

  it("reports a failed search without writing", async () => {
    vi.mocked(searchJobs).mockResolvedValue({ ok: false, status: 404, error: "nope" });
    expect(await runJobAlert(ALERT, { now: ALERT_NOW, supabase: db.client, send })).toEqual({
      ok: false,
      error: "search: nope",
    });
    expect(db.callsFor("bookmarks")).toHaveLength(0);
  });
});
