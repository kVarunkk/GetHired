/**
 * Rate limits and the call log for MCP tool calls (MCP spec §4.7). Every
 * call writes one mcp_tool_calls row, and the limits are counted from those
 * rows, so they hold across Cloud Run instances without in-memory state
 * (MCP-CON-004).
 *
 * The count and the insert aren't one transaction, so a burst of parallel
 * calls can go a few over a limit. That's fine for stopping runaway clients.
 */
import "server-only";
import { after } from "next/server";
import {
  isInputRequiredResult,
  type CallToolResult,
  type InputRequiredResult,
} from "@modelcontextprotocol/server";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { reportError } from "@/helpers/posthog/report-error";
import { PostHogEvent } from "@/utils/types";
import { MCP_CALLS_PER_MINUTE, MCP_CREDIT_CALLS_PER_HOUR, MCP_EMAIL_CALLS_PER_HOUR } from "./config";

/** The `mcp_tool_calls.outcome` values (the migration's check). */
export type McpCallOutcome = "ok" | "error" | "denied" | "rate_limited" | "needs_confirmation";

/** What a tool handler returns: a result, or a request for the user's input (§4.6 path A). */
export type McpResult = CallToolResult | InputRequiredResult;

/** A result whose logged outcome isn't just ok or error, e.g. a declined confirmation. */
export type McpOutcomeResult = { result: McpResult; outcome: McpCallOutcome };

export type McpRunResult = McpResult | McpOutcomeResult;

export const withOutcome = (result: McpResult, outcome: McpCallOutcome): McpOutcomeResult => ({
  result,
  outcome,
});

export const isOutcomeResult = (value: McpRunResult): value is McpOutcomeResult =>
  "outcome" in value && "result" in value;

function outcomeOf(value: McpRunResult): { result: McpResult; outcome: McpCallOutcome } {
  if (isOutcomeResult(value)) return value;
  if (isInputRequiredResult(value)) return { result: value, outcome: "needs_confirmation" };
  return { result: value, outcome: value.isError ? "error" : "ok" };
}

export type McpCall = {
  ctx: AgentToolContext;
  /** The OAuth client the token was issued to. */
  clientId: string;
  /** The MCP tool name. */
  tool: string;
  /** Whether the tool spends credits (mcpToolFlags). */
  credit: boolean;
  /** Whether the tool emails someone (the row's `email` flag, RMCP spec §4.7). */
  email?: boolean;
  /** The session company, for a company caller (RMCP-SEC-005). Applicant calls have none. */
  companyId?: string;
  /** The toolsets on a company caller's URL, for analytics: "all" or the named ones. */
  toolsets?: "all" | readonly string[];
};

type Limit = {
  windowMs: number;
  max: number;
  /** Which calls count: every call not refused by a limit, or only credit or email tools that ran. */
  counts: "all" | "credit" | "email";
  describe: (retry: string) => string;
};

const LIMITS: Limit[] = [
  {
    windowMs: 60_000,
    max: MCP_CALLS_PER_MINUTE,
    counts: "all",
    describe: (retry) =>
      `Too many GetHired tool calls: the limit is ${MCP_CALLS_PER_MINUTE} a minute. Try again in ${retry}.`,
  },
  {
    windowMs: 3_600_000,
    max: MCP_CREDIT_CALLS_PER_HOUR,
    counts: "credit",
    describe: (retry) =>
      `Too many calls to GetHired tools that spend AI credits: the limit is ${MCP_CREDIT_CALLS_PER_HOUR} an hour. Try again in ${retry}.`,
  },
  {
    windowMs: 3_600_000,
    max: MCP_EMAIL_CALLS_PER_HOUR,
    counts: "email",
    describe: (retry) =>
      `Too many calls to GetHired tools that email candidates: the limit is ${MCP_EMAIL_CALLS_PER_HOUR} an hour. Try again in ${retry}.`,
  },
];

const applies = (limit: Limit, call: McpCall) =>
  limit.counts === "all" || (limit.counts === "credit" ? call.credit : Boolean(call.email));

const GENERIC_ERROR = (tool: string): CallToolResult => ({
  content: [{ type: "text", text: `Something went wrong while running ${tool}. Please try again.` }],
  isError: true,
});

function formatWait(ms: number) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/**
 * How long until the user is back under `limit`, or null if they're under it
 * now. Calls refused by a limit don't count, so a client that keeps retrying
 * isn't locked out for longer than the window.
 */
async function waitFor({ ctx }: McpCall, limit: Limit, now: number): Promise<number | null> {
  let query = ctx.supabase
    .from("mcp_tool_calls")
    .select("created_at")
    .eq("user_id", ctx.user.id)
    .gte("created_at", new Date(now - limit.windowMs).toISOString());
  // A preview (needs_confirmation) or a declined confirmation spent and sent nothing.
  query =
    limit.counts === "all"
      ? query.neq("outcome", "rate_limited")
      : query.eq(limit.counts, true).in("outcome", ["ok", "error"]);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit.max);
  if (error) throw error;
  if (!data || data.length < limit.max) return null;
  // The oldest counted call leaving the window frees the next slot.
  const oldest = new Date(data[data.length - 1].created_at).getTime();
  return oldest + limit.windowMs - now;
}

async function logCall(call: McpCall, outcome: McpCallOutcome, startedAt: number) {
  const { ctx, clientId, tool, credit, email, companyId, toolsets } = call;
  const { error } = await ctx.supabase.from("mcp_tool_calls").insert({
    user_id: ctx.user.id,
    client_id: clientId,
    tool,
    credit,
    outcome,
    // Both default in the DB (null, false), so applicant rows leave them out.
    ...(companyId ? { company_id: companyId } : {}),
    ...(email ? { email: true } : {}),
  });
  if (error) reportError("[mcp] failed to log a tool call", { tool, outcome }, error);

  const durationMs = Date.now() - startedAt;
  after(() =>
    eventCaptureServer({
      event: PostHogEvent.McpToolCall,
      distinctId: ctx.user.id,
      properties: {
        tool,
        client_id: clientId,
        outcome,
        duration_ms: durationMs,
        credits: credit,
        role: companyId ? "company" : "applicant",
        ...(companyId ? { toolsets: toolsets ?? "all" } : {}),
      },
    }),
  );
}

/**
 * Runs one tool call under the limits and logs it. Over a limit the call
 * doesn't run and the result is a tool error saying when to retry (not an
 * HTTP 429, so the model can tell the user). Never throws.
 */
export async function runMcpCall(
  call: McpCall,
  run: () => Promise<McpRunResult>,
): Promise<McpResult> {
  const startedAt = Date.now();

  for (const limit of LIMITS) {
    if (!applies(limit, call)) continue;
    let wait: number | null;
    try {
      wait = await waitFor(call, limit, startedAt);
    } catch (error) {
      reportError("[mcp] failed to check the rate limit", { tool: call.tool }, error);
      return GENERIC_ERROR(call.tool);
    }
    if (wait !== null) {
      await logCall(call, "rate_limited", startedAt);
      return { content: [{ type: "text", text: limit.describe(formatWait(wait)) }], isError: true };
    }
  }

  let ran: { result: McpResult; outcome: McpCallOutcome };
  try {
    ran = outcomeOf(await run());
  } catch (error) {
    reportError("[mcp] tool call failed", { tool: call.tool }, error);
    ran = { result: GENERIC_ERROR(call.tool), outcome: "error" };
  }
  await logCall(call, ran.outcome, startedAt);
  return ran.result;
}
