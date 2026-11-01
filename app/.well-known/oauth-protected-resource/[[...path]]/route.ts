/**
 * RFC 9728 protected resource metadata (MCP spec §4.2, MCP-SEC-007). A client
 * that gets a 401 from /api/mcp reads this to find Supabase's OAuth server.
 * Served for /api/mcp and for the bare path; other resources don't exist.
 */
import { MCP_PATH, mcpResourceUrl, supabaseIssuer } from "@/helpers/mcp/config";
import { deploymentUrl } from "@/utils/formatters";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;
  const resourcePath = path?.length ? `/${path.join("/")}` : MCP_PATH;
  if (resourcePath !== MCP_PATH) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(
    {
      resource: mcpResourceUrl(),
      // Explicit, so a custom domain can't put the wrong issuer here (spec §10).
      authorization_servers: [supabaseIssuer()],
      bearer_methods_supported: ["header"],
      resource_name: "GetHired",
      resource_documentation: `${deploymentUrl()}/mcp`,
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
