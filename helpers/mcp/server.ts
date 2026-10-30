/**
 * Builds the per-request MCP server (MCP spec §4.5, RMCP spec §4.8). The
 * caller's type picks the catalog: applicants get MCP_TOOLS over their agent
 * tools, company users with mcp.use get RECRUITER_MCP_TOOLS over the recruiter
 * agent's tools. Either way the user, the company and the Supabase client
 * come from the verified token (MCP-SEC-005, RMCP-SEC-002).
 */
import "server-only";
import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { createAgentTools } from "@/helpers/agent/tools";
import { APPLICANT_APPROVAL_POLICY, type ToolApprovalPolicy } from "@/helpers/agent/approval";
import { RECRUITER_APPROVAL_POLICY } from "@/helpers/agent/roles/recruiter/approval";
import { createRecruiterTools } from "@/helpers/agent/roles/recruiter/tools";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import { deploymentUrl } from "@/utils/formatters";
import { resolveMcpCompany } from "./company";
import { MCP_SERVER_VERSION, MCP_TOOLS_LIST_TTL_MS } from "./config";
import { runConfirmed } from "./confirm";
import { mcpCompanyRefusalCopy, mcpNoAccountTypeCopy } from "./copy";
import { runMcpCall } from "./limits";
import { RECRUITER_MCP_NAMES, RECRUITER_MCP_TOOLS } from "./recruiter-tools";
import { textResult, toCallToolResult } from "./results";
import { toMcpSchema } from "./schema";
import { MCP_TOOLS, bindMcpTool, mcpToolFlags, type McpToolDef } from "./tools";
import { ALL_MCP_TOOLSETS, toolsetsLabel, type McpToolset } from "./toolsets";

export type McpCallContext = {
  /** The agent tool context, with `surface: "mcp"` and no session. */
  ctx: AgentToolContext;
  /** The OAuth client the token was issued to. */
  clientId: string;
  /** The toolsets on the URL (RMCP spec §4.5). Company callers only; default every toolset. */
  toolsets?: ReadonlySet<McpToolset>;
  /** `?readonly=true`: only tools with readOnlyHint. Company callers only. */
  readonly?: boolean;
};

const applicantInstructions = () =>
  `GetHired helps job seekers search jobs, apply, and manage their resumes, reviews and mock interviews. Links in results open ${deploymentUrl()}. These tools are for applicant accounts; company accounts use the web app.`;

const companyInstructions = (toolsets: ReadonlySet<McpToolset>, readonly: boolean) => {
  const label = toolsetsLabel(toolsets);
  const filtered = [
    label === "all" ? null : `Only these toolsets are connected: ${label.length ? label.join(", ") : "core"}.`,
    readonly ? "This connection is read-only." : null,
  ].filter(Boolean);
  return [
    `GetHired helps your hiring team post jobs, find and review candidates, run the pipeline and screening interviews, and manage the team. Tools follow your role's permissions. Links in results open ${deploymentUrl()}.`,
    ...filtered,
  ].join(" ");
};

function newServer(instructions: string) {
  return new McpServer(
    { name: "gethired", title: "GetHired", version: MCP_SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions,
      // The list depends on the user's role, so only the user's client may cache it.
      cacheHints: { "tools/list": { ttlMs: MCP_TOOLS_LIST_TTL_MS, cacheScope: "private" } },
    },
  );
}

/**
 * RMCP-REQ-008: a caller who can't use any catalog gets an empty list, and
 * every tools/call answers with why, as a tool error the model can pass on.
 */
function refusedServer(copy: string) {
  const server = newServer(copy);
  server.server.setRequestHandler("tools/call", () => textResult(copy, true));
  return server;
}

type Catalog<TCtx extends AgentToolContext> = {
  // Each catalog's rows are typed over its own role's tool names.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defs: readonly McpToolDef<any, TCtx, any>[];
  ctx: TCtx;
  tools: Record<string, unknown>;
  policy: ToolApprovalPolicy;
  mcpNames?: Readonly<Record<string, string>>;
  /** The session company and the URL's toolsets, logged with each company call (RMCP spec §4.7, §4.9). */
  company?: { id: string; toolsets: "all" | readonly string[] };
};

/** Registers each row through the shared wrapper: limits → confirm gate → agent tool → result. */
function registerCatalog<TCtx extends AgentToolContext>(
  server: McpServer,
  clientId: string,
  { defs, ctx, tools, policy, mcpNames, company }: Catalog<TCtx>,
) {
  for (const def of defs) {
    const bound = bindMcpTool(def, ctx, tools as never, policy, { mcpNames });
    const { confirm, credit } = mcpToolFlags(def, policy);
    const call = {
      ctx,
      clientId,
      tool: def.name,
      credit,
      email: def.email,
      companyId: company?.id,
      toolsets: company?.toolsets,
    };
    const run = async (input: unknown) => toCallToolResult(await bound.run(input));
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: bound.description,
        inputSchema: toMcpSchema(bound.inputSchema, { confirmationToken: confirm }),
        annotations: { title: def.title, ...def.annotations },
      },
      (args: unknown, request: ServerContext) =>
        runMcpCall(call, () =>
          // The confirm tools run only after the user says yes (§4.6).
          confirm && def.preview
            ? runConfirmed({
                ctx,
                tool: def.name,
                args: args as Record<string, unknown>,
                request,
                preview: (input) => def.preview!(ctx, input),
                run,
              })
            : run(args),
        ),
    );
  }
}

export async function buildMcpServer({
  ctx,
  clientId,
  toolsets = ALL_MCP_TOOLSETS,
  readonly = false,
}: McpCallContext) {
  const type = ctx.user.app_metadata?.type;

  if (type === "applicant") {
    const server = newServer(applicantInstructions());
    registerCatalog(server, clientId, {
      defs: MCP_TOOLS,
      ctx,
      tools: createAgentTools(ctx),
      policy: APPLICANT_APPROVAL_POLICY,
    });
    return server;
  }

  if (type !== "company") return refusedServer(mcpNoAccountTypeCopy());

  // The company is reloaded on every request, so a role change applies from the next call.
  const resolved = await resolveMcpCompany(ctx);
  if (!resolved.ok) return refusedServer(mcpCompanyRefusalCopy(resolved.reason));

  const companyCtx = { ...ctx, company: resolved.company, surface: "mcp" as const };
  // Only the tools the role allows (RP-REQ-030); each checks again when it runs (RP-REQ-031).
  const tools = createRecruiterTools(companyCtx);
  const server = newServer(companyInstructions(toolsets, readonly));
  registerCatalog(server, clientId, {
    defs: RECRUITER_MCP_TOOLS.filter(
      (def) =>
        def.agentTools.every((name) => name in tools) &&
        toolsets.has(def.toolset) &&
        (!readonly || def.annotations.readOnlyHint),
    ),
    ctx: companyCtx,
    tools,
    policy: RECRUITER_APPROVAL_POLICY,
    mcpNames: RECRUITER_MCP_NAMES,
    company: { id: resolved.company.id, toolsets: toolsetsLabel(toolsets) },
  });
  return server;
}
