/** The confirmation preview of the job alert tools (JAT-080, JAT-082). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { toolContext } from "@/test/utils/tools";
import { ALERT_ID, ALERT_USER_ID, alertRow } from "@/test/utils/job-alerts";
import { previewCreateJobAlert, previewUpdateJobAlert } from "@/helpers/mcp/previews";
import { JOB_ALERT_COPY } from "./alerts";
import { previewJobAlert } from "./preview";

const service = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => service.client }));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn(async (names: string[]) => names) }));
vi.mock("@/helpers/jobs/search-jobs", () => ({ searchJobs: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));

import { searchJobs } from "@/helpers/jobs/search-jobs";

let db: SupabaseMock;
const ctx = () => ({ userId: ALERT_USER_ID, supabase: db.client });

const CREATE = { filters: { keywords: ["frontend"], locations: ["Pune"] }, frequency: "daily" };

const otherRows = (count: number, on: boolean) =>
  Array.from({ length: count }, (_, i) => alertRow({ id: `r${i}`, filters_key: `k${i}`, is_alert_on: on }));

const queueRows = (rows: ReturnType<typeof alertRow>[]) => db.queue("bookmarks", { data: rows, error: null });

const expectReadsOnly = () => {
  for (const call of db.callsFor("bookmarks")) {
    const methods = call.chain.map((c) => c.method);
    expect(methods.some((m) => ["insert", "update", "upsert", "delete"].includes(m))).toBe(false);
    expect(call.chain).toContainEqual(expect.objectContaining({ method: "eq", args: ["user_id", ALERT_USER_ID] }));
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  service.client = db.client;
  vi.mocked(searchJobs).mockResolvedValue({
    ok: true,
    data: [1, 2, 3, 4].map((n) => ({ id: `j${n}`, job_name: `Job ${n}`, company_name: "Acme" })),
    totalCount: 12,
    nextCursor: null,
  } as never);
});

describe("previewJobAlert: createJobAlert", () => {
  it("shows the name, frequency and 3 current matches, newest first, without writing", async () => {
    queueRows([]);

    const result = await previewJobAlert(ctx(), "createJobAlert", CREATE);

    expect(result).toEqual({
      ok: true,
      action: "create",
      name: expect.stringMatching(/frontend/i),
      frequency: "daily",
      existing: null,
      sample: { total: 12, jobs: [1, 2, 3].map((n) => ({ id: `j${n}`, title: `Job ${n}`, company: "Acme" })) },
    });
    expect(searchJobs).toHaveBeenCalledWith(
      db.client,
      null,
      expect.objectContaining({ jobTitleKeywords: "frontend", location: "pune", sortBy: "created_at", limit: 3 }),
    );
    expectReadsOnly();
  });

  it("says which saved alert the call would turn on", async () => {
    queueRows([
      alertRow({ filters_key: '{"jobTitleKeywords":["frontend"],"location":["pune"]}', is_alert_on: false }),
    ]);

    expect(await previewJobAlert(ctx(), "createJobAlert", CREATE)).toMatchObject({
      ok: true,
      name: "Frontend jobs in Pune",
      existing: { on: false, frequency: "weekly" },
    });
  });

  it("goes on without a sample when the search fails", async () => {
    queueRows([]);
    vi.mocked(searchJobs).mockRejectedValue(new Error("timeout"));

    expect(await previewJobAlert(ctx(), "createJobAlert", CREATE)).toMatchObject({ ok: true, sample: null });
  });

  it.each([
    ["the active cap", otherRows(5, true), JOB_ALERT_COPY.cap],
    ["the row limit", otherRows(20, false), JOB_ALERT_COPY.rowLimit],
  ])("refuses at %s, so the user isn't asked", async (_what, rows, error) => {
    queueRows(rows);
    expect(await previewJobAlert(ctx(), "createJobAlert", CREATE)).toEqual({ ok: false, error });
  });

  it("refuses a search with nothing to alert on", async () => {
    expect(await previewJobAlert(ctx(), "createJobAlert", { filters: {}, frequency: "daily" })).toEqual({
      ok: false,
      error: JOB_ALERT_COPY.notAlertable,
    });
  });
});

describe("previewJobAlert: updateJobAlert", () => {
  it("shows what changes, without writing", async () => {
    queueRows([alertRow()]);

    expect(
      await previewJobAlert(ctx(), "updateJobAlert", { alertId: ALERT_ID, on: false, frequency: "daily" }),
    ).toEqual({
      ok: true,
      action: "update",
      name: "Frontend jobs in Pune",
      changes: [
        { label: "Status", before: "On", after: "Paused" },
        { label: "Emails", before: "Weekly", after: "Daily" },
      ],
    });
    expectReadsOnly();
  });

  it("refuses an alert that isn't the user's", async () => {
    queueRows([]);
    expect(await previewJobAlert(ctx(), "updateJobAlert", { alertId: ALERT_ID, on: true })).toEqual({
      ok: false,
      error: JOB_ALERT_COPY.notFound,
    });
  });

  it("refuses to resume one past the active cap", async () => {
    queueRows([alertRow({ is_alert_on: false }), ...otherRows(5, true)]);
    expect(await previewJobAlert(ctx(), "updateJobAlert", { alertId: ALERT_ID, on: true })).toEqual({
      ok: false,
      error: JOB_ALERT_COPY.cap,
    });
  });
});

describe("MCP previews", () => {
  const mcp = () => toolContext(createSupabaseMock().client, { sessionId: null, surface: "mcp" });

  it("asks to create the alert, with the sample's posting text delimited as data", async () => {
    queueRows([]);

    const result = await previewCreateJobAlert(mcp(), CREATE);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.details).toContainEqual({ label: "Emails", value: "Daily" });
    const matches = result.details.find((d) => d.label === "Jobs matching now")!.value;
    expect(matches).toContain("12 in total");
    expect(matches).toContain("<matching_jobs>");
  });

  it("asks to change the alert, showing before and after", async () => {
    queueRows([alertRow()]);

    expect(await previewUpdateJobAlert(mcp(), { alertId: ALERT_ID, on: false })).toEqual({
      ok: true,
      summary: "Change this job alert?",
      details: [
        { label: "Alert", value: "Frontend jobs in Pune" },
        { label: "Status", value: "On → Paused" },
      ],
    });
  });
});
