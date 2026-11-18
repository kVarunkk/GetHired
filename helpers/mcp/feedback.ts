/**
 * report_feedback: lets an MCP client's agent tell the GetHired team what went
 * wrong or what's missing. It's in both catalogs, isn't backed by an agent
 * tool, and only writes an mcp_feedback row: it never touches the user's data
 * or contacts anyone.
 */
import { z } from "zod";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import type { McpToolDef } from "./tools";

export const REPORT_FEEDBACK_TOOL_NAME = "report_feedback";

/** The `mcp_feedback.category` values (the migration's check). */
export const MCP_FEEDBACK_CATEGORIES = [
  "bug",
  "missing_capability",
  "confusing",
  "suggestion",
  "praise",
  "other",
] as const;

export const MCP_FEEDBACK_MAX_LENGTH = 4000;

const inputSchema = z.object({
  category: z
    .enum(MCP_FEEDBACK_CATEGORIES)
    .describe(
      "bug: a tool failed or returned something wrong. missing_capability: you needed a tool or option that doesn't exist. confusing: a description, input or result was unclear. suggestion: an idea to make the tools better. praise: something worked well. other: anything else.",
    ),
  message: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FEEDBACK_MAX_LENGTH)
    .describe(
      "What happened and what you expected, in a few sentences. Include the input you sent and the error text if there was one. Leave out personal details about the user or anyone else.",
    ),
  tool: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("The GetHired tool the feedback is about, if any, e.g. search_jobs."),
});

type ReportFeedbackInput = z.infer<typeof inputSchema>;

const outputSchema = z
  .object({
    received: z.literal(true),
    message: z.string(),
  })
  .passthrough();

const DESCRIPTION =
  "Send feedback about these GetHired tools to the GetHired team: a tool that failed or returned something wrong, a capability you needed but couldn't find, a confusing description or result, or a suggestion. Use it whenever something gets in your way, without asking the user first. It only records your note: it doesn't change the user's data, contact anyone or spend credits, and nobody replies to it.";

/**
 * The tool's catalog row. The OAuth client and company come from the caller,
 * since the row's body only gets the agent context.
 */
export function reportFeedbackTool<TCtx extends AgentToolContext>({
  clientId,
  companyId,
}: {
  clientId: string;
  companyId?: string;
}): McpToolDef<string, TCtx, Record<string, never>> {
  return {
    name: REPORT_FEEDBACK_TOOL_NAME,
    title: "Report feedback",
    toolset: "core",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    agentTools: [],
    description: DESCRIPTION,
    outputSchema,
    custom: {
      inputSchema,
      run: async ({ category, message, tool }: ReportFeedbackInput, ctx: TCtx) => {
        const { error } = await ctx.supabase.from("mcp_feedback").insert({
          user_id: ctx.user.id,
          client_id: clientId,
          category,
          message,
          tool: tool ?? null,
          ...(companyId ? { company_id: companyId } : {}),
        });
        if (error) throw error;
        return { received: true, message: "Thanks, the GetHired team has your feedback." };
      },
    },
  };
}
