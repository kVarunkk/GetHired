/**
 * Tunables and fixed URLs for the MCP server at /api/mcp (MCP spec §4.3, §4.7).
 * No server-only imports: the middleware reads MCP_PATH too.
 */
import { deploymentUrl } from "@/utils/formatters";

export const MCP_PATH = "/api/mcp";

/** The public page that explains the server and how to connect a client. */
export const MCP_PAGE_PATH = "/mcp";

/** The server's version in serverInfo. 1.x was the separate Render server. */
export const MCP_SERVER_VERSION = "2.0.0";

/**
 * The rest of serverInfo (2026-07-28 `Implementation`): what the server is
 * for, the public setup page and the app icon (app/icon.png, served by Next
 * at /icon.png and outside the middleware's auth).
 */
export const mcpServerInfo = () => ({
  name: "gethired",
  title: "GetHired",
  description:
    "GetHired's job platform for AI agents. For job seekers: search jobs and get personalised matches, read and submit application forms, track applications, create, edit, tailor and download resumes, and set up mock interviews. For hiring teams: post jobs, find and review candidates, run the pipeline and screening interviews, and manage the team, within their role's permissions.",
  websiteUrl: `${deploymentUrl()}${MCP_PAGE_PATH}`,
  icons: [{ src: `${deploymentUrl()}/icon.png`, mimeType: "image/png", sizes: ["377x377"] }],
});

/** How long a client may cache tools/list (2026-07-28 `ttlMs`, private scope). */
export const MCP_TOOLS_LIST_TTL_MS = 5 * 60 * 1000;

/** RFC 9728 metadata lives under this prefix, followed by the resource's path. */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/** The resource a client connects to (the `resource` in the metadata document). */
export const mcpResourceUrl = () => `${deploymentUrl()}${MCP_PATH}`;

/** Where a 401's WWW-Authenticate header points (MCP-SEC-007). */
export const mcpResourceMetadataUrl = () =>
  `${deploymentUrl()}${PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}`;

/**
 * Hostnames /api/mcp answers on, for the Host and Origin checks (MCP-SEC-008):
 * the app's own, plus localhost outside production.
 */
export const mcpAllowedHostnames = () => {
  const own = new URL(deploymentUrl()).hostname;
  return process.env.NODE_ENV === "production" ? [own] : [own, "localhost", "127.0.0.1"];
};

/** Supabase's OAuth 2.1 server: the issuer of every token /api/mcp accepts (MCP-SEC-001). */
export const supabaseIssuer = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`;

/** Every Supabase user token has this audience (MCP-SEC-002). */
export const MCP_TOKEN_AUDIENCE = "authenticated";

/** Rate limits, counted from mcp_tool_calls (§4.7). */
export const MCP_CALLS_PER_MINUTE = 60;
export const MCP_CREDIT_CALLS_PER_HOUR = 10;
/** Calls to tools that email candidates, per user (RMCP spec §4.7; replaces the agent's 3 per turn). */
export const MCP_EMAIL_CALLS_PER_HOUR = 10;

/** How long a confirmation (requestState or confirmation_token) stays valid (MCP-SEC-011). */
export const MCP_CONFIRMATION_TTL_SECONDS = 600;
