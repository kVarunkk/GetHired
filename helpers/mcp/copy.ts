/**
 * What a company caller sees when they can't use the recruiter tools
 * (RMCP-REQ-008): the server instructions and the tools/call error. Copy
 * names the missing permission, never a role.
 */
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { deploymentUrl } from "@/utils/formatters";

export type McpCompanyRefusal = "not_onboarded" | "no_company" | "forbidden";

export function mcpCompanyRefusalCopy(reason: McpCompanyRefusal): string {
  if (reason === "forbidden") {
    return `${forbiddenMessage("mcp.use")} Ask someone who manages your company's roles for the permission.`;
  }
  return `Finish setting up your company at ${deploymentUrl()}/get-started?company=true, then reconnect.`;
}

/** For an account with no type: it hasn't picked job seeker or company yet. */
export const mcpNoAccountTypeCopy = () =>
  `This account isn't set up yet. Finish signing up at ${deploymentUrl()}, then reconnect.`;
