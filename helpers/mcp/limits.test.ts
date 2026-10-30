/**
 * Rate limits and the call log (MCP TASK-050, spec §4.7): every call is
 * logged with its outcome, and a client over a limit gets a tool error that
 * says when to retry instead of a run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inputRequired, type CallToolResult } from "@modelcontextprotocol/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { toolContext } from "@/test/utils/tools";
import { flushAfter } from "@/test/utils/after";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import { PostHogEvent } from "@/utils/types";
import { MCP_CALLS_PER_MINUTE, MCP_CREDIT_CALLS_PER_HOUR, MCP_EMAIL_CALLS_PER_HOUR } from "./config";
import { runMcpCall, withOutcome, type McpCall } from "./limits";

vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const NOW = new Date("2026-10-28T12:00:00.000Z");
const OK: CallToolResult = { content: [{ type: "text", text: "{}" }], structuredContent: {} };

let supabase: SupabaseMock;
let call: McpCall;

/** `count` recent rows, the oldest `oldestSecondsAgo` seconds ago, newest first. */
function rows(count: number, oldestSecondsAgo: number) {
  return Array.from({ length: count }, (_, i) => ({
    created_at: new Date(NOW.getTime() - (oldestSecondsAgo * 1000 * (i + 1)) / count).toISOString(),
  }));
}

const logged = () =>
  supabase
    .callsFor("mcp_tool_calls")
    .flatMap((c) => c.chain.filter((step) => step.method === "insert").map((step) => step.args[0]));

const windowQueries = () =>
  supabase.callsFor("mcp_tool_calls").filter((c) => c.chain.some((step) => step.method === "select"));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.mocked(eventCaptureServer).mockClear();
  vi.mocked(reportError).mockClear();
  supabase = createSupabaseMock();
  call = {
    ctx: { ...toolContext(supabase.client), surface: "mcp", sessionId: null },
    clientId: "client-1",
    tool: "search_jobs",
    credit: false,
  };
});

describe("runMcpCall under the limits", () => {
  it("runs the call and logs it as ok", async () => {
    supabase.queue("mcp_tool_calls", { data: rows(3, 30), error: null });
    const run = vi.fn().mockResolvedValue(OK);

    const result = await runMcpCall(call, run);

    expect(run).toHaveBeenCalledOnce();
    expect(result).toBe(OK);
    expect(logged()).toEqual([
      { user_id: call.ctx.user.id, client_id: "client-1", tool: "search_jobs", credit: false, outcome: "ok" },
    ]);
  });

  it("counts the user's last minute of calls, leaving out ones it already refused", async () => {
    await runMcpCall(call, vi.fn().mockResolvedValue(OK));

    const [query] = windowQueries();
    expect(query.chain).toContainEqual({ method: "eq", args: ["user_id", call.ctx.user.id] });
    expect(query.chain).toContainEqual({
      method: "gte",
      args: ["created_at", new Date(NOW.getTime() - 60_000).toISOString()],
    });
    expect(query.chain).toContainEqual({ method: "neq", args: ["outcome", "rate_limited"] });
    expect(query.chain).toContainEqual({ method: "limit", args: [MCP_CALLS_PER_MINUTE] });
  });

  it("doesn't check the credit limit for a tool that spends no credits", async () => {
    await runMcpCall(call, vi.fn().mockResolvedValue(OK));

    expect(windowQueries()).toHaveLength(1);
  });

  it("logs an isError result as error", async () => {
    const failed: CallToolResult = { content: [{ type: "text", text: "Job not found." }], isError: true };

    expect(await runMcpCall(call, vi.fn().mockResolvedValue(failed))).toBe(failed);
    expect(logged()[0]).toMatchObject({ outcome: "error" });
  });

  it("logs a request for the user's confirmation as needs_confirmation", async () => {
    const asking = inputRequired({ inputRequests: {}, requestState: "state" });

    expect(await runMcpCall(call, vi.fn().mockResolvedValue(asking))).toBe(asking);
    expect(logged()[0]).toMatchObject({ outcome: "needs_confirmation" });
  });

  it("logs the outcome a confirm tool gives, and returns its result", async () => {
    const declined: CallToolResult = { content: [{ type: "text", text: "The user declined." }] };

    expect(await runMcpCall(call, vi.fn().mockResolvedValue(withOutcome(declined, "denied")))).toBe(declined);
    expect(logged()[0]).toMatchObject({ outcome: "denied" });
  });

  it("logs a thrown error as error and answers with a generic tool error", async () => {
    const result = await runMcpCall(call, vi.fn().mockRejectedValue(new Error("db exploded")));

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/db exploded/);
    expect(logged()[0]).toMatchObject({ outcome: "error" });
    expect(reportError).toHaveBeenCalled();
  });

  it("still returns the result when the log insert fails", async () => {
    supabase.queue("mcp_tool_calls", { data: [], error: null });
    supabase.queue("mcp_tool_calls", { data: null, error: { message: "insert failed" } });

    expect(await runMcpCall(call, vi.fn().mockResolvedValue(OK))).toBe(OK);
    expect(reportError).toHaveBeenCalled();
  });

  it("fires an mcp_tool_call event with the outcome and duration", async () => {
    await runMcpCall({ ...call, credit: true, tool: "natural_language_job_search" }, vi.fn().mockResolvedValue(OK));
    await flushAfter();

    expect(eventCaptureServer).toHaveBeenCalledWith({
      event: PostHogEvent.McpToolCall,
      distinctId: call.ctx.user.id,
      properties: {
        tool: "natural_language_job_search",
        client_id: "client-1",
        outcome: "ok",
        duration_ms: expect.any(Number),
        credits: true,
        role: "applicant",
      },
    });
  });
});

describe("runMcpCall over MCP_CALLS_PER_MINUTE", () => {
  it("doesn't run the call, says when to retry, and logs rate_limited", async () => {
    // The oldest of the 60 counted calls was 45 seconds ago, so a slot frees in 15.
    supabase.queue("mcp_tool_calls", { data: rows(MCP_CALLS_PER_MINUTE, 45), error: null });
    const run = vi.fn().mockResolvedValue(OK);

    const result = await runMcpCall(call, run);

    expect(run).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect((result as CallToolResult).content[0]).toMatchObject({ type: "text", text: expect.stringMatching(/try again in 15 seconds/i) });
    expect(logged()[0]).toMatchObject({ outcome: "rate_limited", tool: "search_jobs" });
  });
});

describe("runMcpCall over MCP_CREDIT_CALLS_PER_HOUR", () => {
  beforeEach(() => {
    call = { ...call, tool: "natural_language_job_search", credit: true };
  });

  it("counts only the credit tools that ran in the last hour", async () => {
    await runMcpCall(call, vi.fn().mockResolvedValue(OK));

    const query = windowQueries()[1];
    expect(query.chain).toContainEqual({
      method: "gte",
      args: ["created_at", new Date(NOW.getTime() - 3_600_000).toISOString()],
    });
    expect(query.chain).toContainEqual({ method: "eq", args: ["credit", true] });
    expect(query.chain).toContainEqual({ method: "in", args: ["outcome", ["ok", "error"]] });
    expect(query.chain).toContainEqual({ method: "limit", args: [MCP_CREDIT_CALLS_PER_HOUR] });
  });

  it("refuses a credit tool with a retry time in minutes and logs rate_limited", async () => {
    supabase.queue("mcp_tool_calls", { data: rows(2, 30), error: null });
    // The oldest of the 10 counted credit calls was 50 minutes ago: retry in 10.
    supabase.queue("mcp_tool_calls", { data: rows(MCP_CREDIT_CALLS_PER_HOUR, 50 * 60), error: null });
    const run = vi.fn().mockResolvedValue(OK);

    const result = await runMcpCall(call, run);

    expect(run).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect((result as CallToolResult).content[0]).toMatchObject({ text: expect.stringMatching(/try again in 10 minutes/i) });
    expect(logged()[0]).toMatchObject({ outcome: "rate_limited", credit: true });
  });

  it("still runs tools that spend no credits", async () => {
    supabase.queue("mcp_tool_calls", { data: rows(2, 30), error: null });
    const run = vi.fn().mockResolvedValue(OK);

    expect(await runMcpCall({ ...call, tool: "search_jobs", credit: false }, run)).toBe(OK);
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("runMcpCall when the limit check fails", () => {
  it("doesn't run the call and answers with a generic tool error", async () => {
    supabase.queue("mcp_tool_calls", { data: null, error: { message: "timeout" } });
    const run = vi.fn().mockResolvedValue(OK);

    const result = await runMcpCall(call, run);

    expect(run).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/timeout/);
    expect(reportError).toHaveBeenCalled();
  });
});

describe("company calls (RMT-052, RMCP-SEC-005)", () => {
  const COMPANY_ID = "c0000000-0000-4000-8000-000000000001";

  it("records company_id on a company call, and leaves it out of an applicant call", async () => {
    await runMcpCall({ ...call, tool: "list_applicants", companyId: COMPANY_ID }, vi.fn().mockResolvedValue(OK));
    await runMcpCall(call, vi.fn().mockResolvedValue(OK));

    const [company, applicant] = logged();
    expect(company).toMatchObject({ tool: "list_applicants", company_id: COMPANY_ID });
    expect(company).not.toHaveProperty("email");
    expect(applicant).not.toHaveProperty("company_id");
  });
});

describe("runMcpCall over MCP_EMAIL_CALLS_PER_HOUR (RMT-052, RMCP-SEC-006)", () => {
  const COMPANY_ID = "c0000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    call = { ...call, tool: "send_outreach", credit: false, email: true, companyId: COMPANY_ID };
  });

  it.each(["move_applications", "send_outreach", "invite_to_interview"])(
    "logs %s with email = true and counts only email tools that ran",
    async (tool) => {
      await runMcpCall({ ...call, tool }, vi.fn().mockResolvedValue(OK));

      expect(logged()[0]).toMatchObject({ tool, email: true, company_id: COMPANY_ID });
      const query = windowQueries()[1];
      expect(query.chain).toContainEqual({ method: "eq", args: ["user_id", call.ctx.user.id] });
      expect(query.chain).toContainEqual({
        method: "gte",
        args: ["created_at", new Date(NOW.getTime() - 3_600_000).toISOString()],
      });
      expect(query.chain).toContainEqual({ method: "eq", args: ["email", true] });
      // needs_confirmation (the preview) and denied rows sent nothing, so they don't count.
      expect(query.chain).toContainEqual({ method: "in", args: ["outcome", ["ok", "error"]] });
      expect(query.chain).toContainEqual({ method: "limit", args: [MCP_EMAIL_CALLS_PER_HOUR] });
    },
  );

  it("refuses an email tool over the limit with a retry time, and logs rate_limited", async () => {
    supabase.queue("mcp_tool_calls", { data: rows(2, 30), error: null });
    // The oldest of the 10 counted email calls was 40 minutes ago: retry in 20.
    supabase.queue("mcp_tool_calls", { data: rows(MCP_EMAIL_CALLS_PER_HOUR, 40 * 60), error: null });
    const run = vi.fn().mockResolvedValue(OK);

    const result = await runMcpCall(call, run);

    expect(run).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect((result as CallToolResult).content[0]).toMatchObject({
      text: expect.stringMatching(/email candidates: the limit is 10 an hour\. Try again in 20 minutes/),
    });
    expect(logged()[0]).toMatchObject({ outcome: "rate_limited", email: true });
  });

  it("still runs a tool that emails nobody", async () => {
    supabase.queue("mcp_tool_calls", { data: rows(2, 30), error: null });
    const run = vi.fn().mockResolvedValue(OK);

    expect(await runMcpCall({ ...call, tool: "list_applicants", email: false }, run)).toBe(OK);
    expect(run).toHaveBeenCalledOnce();
    expect(windowQueries()).toHaveLength(1);
  });

  it("checks both hourly limits for a tool that spends credits and emails", async () => {
    await runMcpCall({ ...call, credit: true }, vi.fn().mockResolvedValue(OK));

    const [, credit, email] = windowQueries();
    expect(credit.chain).toContainEqual({ method: "eq", args: ["credit", true] });
    expect(email.chain).toContainEqual({ method: "eq", args: ["email", true] });
  });
});

describe("the mcp_tool_call event (RMT-053, RMCP spec §4.9)", () => {
  it("tags a company call with its role and the toolsets in use", async () => {
    await runMcpCall(
      { ...call, tool: "list_applicants", companyId: "c0000000-0000-4000-8000-000000000001", toolsets: ["jobs"] },
      vi.fn().mockResolvedValue(OK),
    );
    await runMcpCall(
      { ...call, tool: "list_my_jobs", companyId: "c0000000-0000-4000-8000-000000000001", toolsets: "all" },
      vi.fn().mockResolvedValue(OK),
    );
    await flushAfter();

    expect(vi.mocked(eventCaptureServer).mock.calls.map(([event]) => event.properties)).toEqual([
      expect.objectContaining({ tool: "list_applicants", role: "company", toolsets: ["jobs"] }),
      expect.objectContaining({ tool: "list_my_jobs", role: "company", toolsets: "all" }),
    ]);
  });

  it("tags an applicant call as applicant, with no toolsets", async () => {
    await runMcpCall(call, vi.fn().mockResolvedValue(OK));
    await flushAfter();

    const [[event]] = vi.mocked(eventCaptureServer).mock.calls;
    expect(event.properties).toMatchObject({ role: "applicant" });
    expect(event.properties).not.toHaveProperty("toolsets");
  });
});
