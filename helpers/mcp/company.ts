/**
 * The company an MCP call acts for (RMCP spec §4.2): the counterpart of
 * requireAgentUser's company branch, with mcp.use in place of agent.use. The
 * company always comes from the session (RMCP-SEC-002), reloaded on every
 * request, so a role or membership change applies from the next call.
 */
import "server-only";
import { getMyCompany, type MyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import type { McpCompanyRefusal } from "./copy";

export type McpCompanyResult = { ok: true; company: MyCompany } | { ok: false; reason: McpCompanyRefusal };

export async function resolveMcpCompany(
  ctx: Pick<AgentToolContext, "supabase" | "user">,
): Promise<McpCompanyResult> {
  if (ctx.user.app_metadata?.onboarding_complete !== true) return { ok: false, reason: "not_onboarded" };
  const company = await getMyCompany(ctx.supabase, ctx.user);
  if (!company) return { ok: false, reason: "no_company" };
  if (!can(company, "mcp.use")) return { ok: false, reason: "forbidden" };
  return { ok: true, company };
}
