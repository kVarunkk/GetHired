/** The job alert tools (JAT-080, JA-REQ-060). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_ALERT_COPY } from "@/helpers/job-alerts/alerts";
import { APPLICANT_APPROVAL_POLICY, agentToolApproval } from "@/helpers/agent/approval";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { execTool, toolContext, validateInput } from "@/test/utils/tools";
import { ALERT_ID, alertRow } from "@/test/utils/job-alerts";
import { createJobAlertTools } from "./job-alerts";
import type { AgentToolContext } from "./shared";

const service = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => service.client }));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn(async (names: string[]) => names) }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));

import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";

let db: SupabaseMock;
let own: SupabaseMock;

const tools = (overrides: Partial<AgentToolContext> = {}) =>
  createJobAlertTools(toolContext(own.client, overrides));

const argsOf = (index: number, method: string) =>
  db.callsFor("bookmarks")[index].chain.filter((c) => c.method === method).map((c) => c.args);

const queueNewAlert = (row = alertRow()) => {
  db.queue("bookmarks", { data: null, error: null }); // no existing key
  db.queue("bookmarks", { data: null, error: null, count: 1 }); // row count
  db.queue("bookmarks", { data: row, error: null });
};

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock(); // the service-role client
  own = createSupabaseMock(); // the request's client, which the writes must not use
  service.client = db.client;
});

describe("createJobAlert", () => {
  it("saves searchJobs-shaped filters as the user's alert, with the surface as its source", async () => {
    queueNewAlert();

    const result = await execTool(tools().createJobAlert, {
      filters: { keywords: ["Frontend", "front-end"], locations: ["Pune"], jobTypes: ["Fulltime"] },
      frequency: "daily",
    });

    const [insert] = argsOf(2, "insert")[0] as [Record<string, unknown>];
    expect(insert).toMatchObject({
      user_id: "u1",
      source: "agent",
      frequency: "daily",
      filters: { jobTitleKeywords: ["front-end", "frontend"], location: ["pune"], jobType: ["Fulltime"] },
    });
    expect(result).toEqual({
      alreadyExisted: false,
      alert: {
        id: ALERT_ID,
        name: "Frontend jobs in Pune",
        frequency: "weekly",
        on: true,
        jobsUrl: "/jobs?jobTitleKeywords=frontend&location=pune",
      },
      manageUrl: "/settings#job-alerts",
    });
    expect(own.calls).toHaveLength(0);
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({ distinctId: "u1", properties: expect.objectContaining({ source: "agent" }) }),
    );
  });

  it("records MCP as the source over MCP", async () => {
    queueNewAlert();

    await execTool(tools({ surface: "mcp", sessionId: null }).createJobAlert, {
      filters: { keywords: ["frontend"] },
      frequency: "weekly",
    });

    expect((argsOf(2, "insert")[0] as [Record<string, unknown>])[0]).toMatchObject({ source: "mcp" });
  });

  it("refuses a search with nothing to alert on", async () => {
    const result = await execTool(tools().createJobAlert, { filters: {}, frequency: "weekly" });

    expect(result).toEqual({ error: JOB_ALERT_COPY.notAlertable });
    expect(db.calls).toHaveLength(0);
  });

  it.each(["visaRequirements", "postedWithinDays", "experienceYears"])(
    "refuses %s instead of dropping it, since an alert can't keep it",
    async (key) => {
      const result = await validateInput(tools().createJobAlert, {
        filters: { keywords: ["frontend"], [key]: key === "visaRequirements" ? ["Will Sponsor"] : 3 },
        frequency: "weekly",
      });
      expect(result.success).toBe(false);
    },
  );

  it("answers the active alert cap with its copy", async () => {
    db.queue("bookmarks", { data: null, error: null });
    db.queue("bookmarks", { data: null, error: null, count: 5 });
    db.queue("bookmarks", { data: null, error: { code: "23514", message: "maximum of 5 active alerts" } as never });

    const result = await execTool(tools().createJobAlert, { filters: { keywords: ["go"] }, frequency: "daily" });

    expect(result).toEqual({ error: JOB_ALERT_COPY.cap });
  });
});

describe("listJobAlerts", () => {
  it("lists only the context user's alerts, with how many are on", async () => {
    db.queue("bookmarks", { data: [alertRow(), alertRow({ id: "other", is_alert_on: false })], error: null });

    const result = (await execTool(tools().listJobAlerts, {})) as { alerts: unknown[] };

    expect(argsOf(0, "eq")).toContainEqual(["user_id", "u1"]);
    expect(result).toMatchObject({ activeCount: 1, maxActive: 5 });
    expect(result.alerts[0]).toMatchObject({
      id: ALERT_ID,
      filters: { jobTitleKeywords: ["frontend"], location: ["pune"] },
      on: true,
    });
  });
});

describe("updateJobAlert", () => {
  it("pauses one of the user's alerts", async () => {
    db.queue("bookmarks", { data: alertRow({ is_alert_on: false }), error: null });

    const result = await execTool(tools().updateJobAlert, { alertId: ALERT_ID, on: false });

    expect(argsOf(0, "update")[0]).toEqual([{ is_alert_on: false }]);
    expect(argsOf(0, "eq")).toEqual(
      expect.arrayContaining([
        ["id", ALERT_ID],
        ["user_id", "u1"],
      ]),
    );
    expect(result).toMatchObject({ alert: { id: ALERT_ID, on: false } });
  });

  it("says what's missing when there's nothing to change", async () => {
    expect(await execTool(tools().updateJobAlert, { alertId: ALERT_ID })).toEqual({
      error: JOB_ALERT_COPY.noChange,
    });
    expect(db.calls).toHaveLength(0);
  });

  it("says when the alert isn't the user's", async () => {
    db.queue("bookmarks", { data: null, error: null });

    expect(await execTool(tools().updateJobAlert, { alertId: ALERT_ID, frequency: "daily" })).toEqual({
      error: JOB_ALERT_COPY.notFound,
    });
  });
});

describe("approval", () => {
  const decide = (toolName: string) =>
    agentToolApproval({ toolCall: { toolName, toolCallId: "c1" }, messages: [] });

  it("always asks before creating or changing an alert, never before listing", () => {
    expect(APPLICANT_APPROVAL_POLICY.alwaysAsk).toEqual(
      expect.arrayContaining(["createJobAlert", "updateJobAlert"]),
    );
    expect(decide("createJobAlert")).toBe("user-approval");
    expect(decide("updateJobAlert")).toBe("user-approval");
    expect(decide("listJobAlerts")).not.toBe("user-approval");
  });
});
