/**
 * The GetHired MCP server (MCP spec §4.1). Stateless: each request verifies
 * its OAuth token, resolves the user and builds a fresh server whose tools
 * run on a user-scoped client. 2025-era clients go through the SDK's
 * stateless legacy path, which also answers GET and DELETE with 405.
 */
import { after } from "next/server";
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { flushAgentTraces } from "@/helpers/agent/telemetry";
import { createMcpSupabaseClient, unauthorized, verifyMcpToken } from "@/helpers/mcp/auth";
import { mcpAllowedHostnames } from "@/helpers/mcp/config";
import { buildMcpServer } from "@/helpers/mcp/server";
import { MCP_CORE_TOOLSET, MCP_TOOLSETS, parseToolsetParams } from "@/helpers/mcp/toolsets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The URL is set once, so a typo in it fails loudly instead of hiding tools. */
function invalidToolsets(invalid: string[]) {
  const valid = ["all", MCP_CORE_TOOLSET, ...MCP_TOOLSETS];
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32602,
        message: `Unknown GetHired toolset${invalid.length === 1 ? "" : "s"} in the server URL: ${invalid.join(", ")}. Valid toolsets: ${valid.join(", ")}.`,
        data: { invalid, valid },
      },
    },
    { status: 400 },
  );
}

async function handle(request: Request) {
  // MCP-SEC-008: the SDK's handler checks neither.
  const allowed = mcpAllowedHostnames();
  const rejected =
    hostHeaderValidationResponse(request, allowed) ?? originValidationResponse(request, allowed);
  if (rejected) return rejected;

  const verified = await verifyMcpToken(request);
  if (!verified.ok) return verified.response;
  const { token, claims } = verified;

  // MCP-SEC-003/004: a user-scoped client, and the user from Supabase Auth on
  // every request, so a revoked grant stops working before the token expires.
  const supabase = createMcpSupabaseClient(token);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user || user.id !== claims.sub) {
    return unauthorized({ invalidToken: true });
  }

  // RMCP spec §4.5: toolsets narrow the company catalog. Applicants ignore them.
  const isCompany = user.app_metadata?.type === "company";
  const params = parseToolsetParams(new URL(request.url));
  if (!params.ok && isCompany) return invalidToolsets(params.invalid);
  const { toolsets, readonly } = params.ok && isCompany ? params : { toolsets: undefined, readonly: false };

  const ctx = { supabase, user, sessionId: null, surface: "mcp" as const };
  const handler = createMcpHandler(() =>
    buildMcpServer({ ctx, clientId: claims.client_id, toolsets, readonly }),
  );
  // A tool's model call is traced (RMCP spec §4.9); send its spans once the response is done.
  after(flushAgentTraces);
  return handler.fetch(request, {
    authInfo: {
      token,
      clientId: claims.client_id,
      scopes: typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [],
      expiresAt: claims.exp,
      extra: { userId: user.id },
    },
  });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
